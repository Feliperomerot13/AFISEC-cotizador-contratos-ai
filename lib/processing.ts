import { CONTRACT_STATES, PROMPT_VERSION } from "@/lib/constants";
import {
  normalizeCoverage,
  type CoverageSubamparo,
} from "@/lib/coverage-calculations";
import type { Database, Json } from "@/lib/database.types";
import { getServerEnv } from "@/lib/env";
import {
  getExtractionValue,
  normalizeBoolean,
  normalizeCurrency,
  normalizeDate,
  normalizeEnum,
  normalizeInteger,
  normalizeNumber,
  normalizeText,
} from "@/lib/normalizers";
import {
  buildContractExtractionContext,
  countLowConfidenceFields,
  estimatePdfPageCount,
  extractPdfTextByPage,
  extractStructuredAmendment,
  extractStructuredContract,
  InvalidAIJsonError,
  stringifyPages,
  type OpenAIAmendmentExtractionResult,
  type OpenAIExtractionResult,
  type PageSelectionDetail,
} from "@/lib/ai";
import { getErrorMessage } from "@/lib/api";
import type { AIExtraction, AmendmentExtraction } from "@/lib/schemas";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type ProcessingContext = {
  contratoId: DbInt8;
  documentoId: DbInt8 | null;
  textoExtraido: string | null;
};

type ContractUpdate = Database["public"]["Tables"]["contratos"]["Update"];
type CoverageInsert = Database["public"]["Tables"]["amparos"]["Insert"];
type DbInt8 = Database["public"]["Tables"]["contratos"]["Row"]["id"];

type NormalizationReport = {
  corrected: string[];
  discarded: string[];
  fieldTypes: Record<string, string>;
};

type CoverageMappingResult = {
  rows: CoverageInsert[];
  skipped: Array<{
    index: number;
    tipo_amparo: string | null;
    reason: string;
    fuente_pagina: number | null;
    fuente_texto: string | null;
  }>;
};

const CONTRACT_TYPE_VALUES = ["estatal", "particular"] as const;
const CONFIDENCE_VALUES = ["alta", "media", "baja"] as const;
const COVERAGE_VALIDITY_TYPES = ["contractual", "post_contractual"] as const;
const COVERAGE_VALIDITY_BASES = [
  "fecha_inicio_contrato",
  "fecha_fin_contrato",
  "acta_recibo_final",
  "fecha_explicita",
  "no_determinada",
  "firma_contrato",
  "otra",
] as const;
const MIN_DOCUMENT_INTELLIGENCE_PAGE_COVERAGE_RATIO = 0.7;
const MAX_TOLERATED_MISSING_PAGES = 2;

export async function processContract(contratoId: DbInt8) {
  const context: ProcessingContext = {
    contratoId,
    documentoId: null,
    textoExtraido: null,
  };

  try {
    const supabase = getSupabaseAdmin();

    await updateContractOrThrow(contratoId, {
      estado: "procesando",
      mensaje_error: null,
    });

    const { data: documento, error: documentError } = await supabase
      .from("documentos")
      .select("*")
      .eq("contrato_id", contratoId)
      .order("fecha_carga", { ascending: false })
      .limit(1)
      .single();

    if (documentError || !documento) {
      throw new Error(
        `No se encontró el documento PDF asociado: ${documentError?.message ?? "sin detalle"}`,
      );
    }

    context.documentoId = documento.id;

    const { data: storedFile, error: downloadError } = await supabase.storage
      .from(documento.storage_bucket)
      .download(documento.storage_path);

    if (downloadError || !storedFile) {
      throw new Error(
        `Fallo al leer el PDF desde Supabase Storage: ${downloadError?.message ?? "sin detalle"}`,
      );
    }

    const pdfBuffer = await storedFile.arrayBuffer();
    const estimatedPageCount = estimatePdfPageCount(pdfBuffer);
    const extractedPages = await extractPdfTextByPage(pdfBuffer);
    const textoExtraido = stringifyPages(extractedPages);
    context.textoExtraido = textoExtraido;

    assertDocumentIntelligencePageCoverage({
      estimatedPageCount,
      extractedPageCount: extractedPages.length,
    });
    const extractionContext = buildContractExtractionContext(extractedPages);

    logExtractionContextForDevelopment({
      totalPages: extractedPages.length,
      estimatedPageCount,
      fullText: textoExtraido,
      openAiContext: extractionContext.text,
      openAiPages: extractionContext.pageNumbers,
      pageDetails: extractionContext.pageDetails,
      truncated: extractionContext.truncated,
      documentType: documento.tipo_documento,
      fileName: documento.nombre_archivo,
    });

    const env = getServerEnv();

    if (documento.tipo_documento === "otrosi") {
      await processAmendmentExtraction({
        contratoId,
        documentoId: documento.id,
        extractedText: textoExtraido,
        openAiContext: extractionContext.text,
        deployment: env.AZURE_OPENAI_DEPLOYMENT_PRIMARY,
      });
      return;
    }

    logExtractionAttemptForDevelopment({
      deployment: env.AZURE_OPENAI_DEPLOYMENT_PRIMARY,
      phase: "primary_start",
    });
    const primary = applyDeterministicDateFallbacksToResult(
      await extractStructuredContract(
        env.AZURE_OPENAI_DEPLOYMENT_PRIMARY,
        extractionContext.text,
      ),
      extractionContext.text,
    );
    const primaryCriticalMissing = getCriticalMissingFields(primary.extraction);
    const primaryLowConfidenceCount = countLowConfidenceFields(
      primary.extraction,
    );
    logExtractionResultForDevelopment({
      result: primary,
      criticalMissing: primaryCriticalMissing,
      phase: "primary_result",
    });

    await insertExtractionLog({
      contractId: contratoId,
      documentId: documento.id,
      extractedText: textoExtraido,
      result: primary,
      resultado: getExtractionLogResult(primary.extraction),
    });

    const threshold = Number.isFinite(env.CONFIANZA_FALLBACK_THRESHOLD)
      ? env.CONFIANZA_FALLBACK_THRESHOLD
      : 3;
    let selected = primary;
    const shouldFallback =
      primaryLowConfidenceCount >= threshold ||
      primaryCriticalMissing.length > 0;

    if (
      shouldFallback &&
      env.AZURE_OPENAI_DEPLOYMENT_FALLBACK !== env.AZURE_OPENAI_DEPLOYMENT_PRIMARY
    ) {
      logFallbackDecisionForDevelopment({
        triggered: true,
        reason: {
          lowConfidenceCount: primaryLowConfidenceCount,
          threshold,
          criticalMissing: primaryCriticalMissing,
        },
        fallbackDeployment: env.AZURE_OPENAI_DEPLOYMENT_FALLBACK,
      });
      const fallback = applyDeterministicDateFallbacksToResult(
        await extractStructuredContract(
          env.AZURE_OPENAI_DEPLOYMENT_FALLBACK,
          extractionContext.text,
        ),
        extractionContext.text,
      );
      const fallbackCriticalMissing = getCriticalMissingFields(
        fallback.extraction,
      );

      logExtractionResultForDevelopment({
        result: fallback,
        criticalMissing: fallbackCriticalMissing,
        phase: "fallback_result",
      });

      await insertExtractionLog({
        contractId: contratoId,
        documentId: documento.id,
        extractedText: textoExtraido,
        result: fallback,
        resultado: getExtractionLogResult(fallback.extraction),
      });

      selected =
        getExtractionQualityScore(fallback.extraction) <
        getExtractionQualityScore(primary.extraction)
          ? fallback
          : primary;
    } else {
      logFallbackDecisionForDevelopment({
        triggered: false,
        reason: {
          lowConfidenceCount: primaryLowConfidenceCount,
          threshold,
          criticalMissing: primaryCriticalMissing,
          fallbackConfigured:
            env.AZURE_OPENAI_DEPLOYMENT_FALLBACK !==
            env.AZURE_OPENAI_DEPLOYMENT_PRIMARY,
        },
      });
    }

    await saveStructuredExtraction(contratoId, selected.extraction);
  } catch (error) {
    const message = getErrorMessage(error);
    const originalMessage =
      error instanceof InvalidAIJsonError && error.rawContent
        ? `${message} Respuesta cruda truncada: ${error.rawContent.slice(0, 500)}`
        : message;

    try {
      await markContractAsError(context.contratoId, message);
    } catch (markError) {
      console.error(
        "No se pudo marcar el contrato como error.",
        getErrorMessage(markError),
      );
    }

    await insertErrorExtractionLog(context, originalMessage);
  }
}

async function saveStructuredExtraction(
  contratoId: DbInt8,
  extraction: AIExtraction,
) {
  const supabase = getSupabaseAdmin();
  const mappedContractUpdate = mapExtractionToContractUpdate(extraction);
  const { payload: contractUpdate, report } =
    validateContractUpdatePayload(mappedContractUpdate);

  logContractUpdateForDevelopment(contractUpdate, report);

  const { error: updateError } = await supabase
    .from("contratos")
    .update(contractUpdate)
    .eq("id", contratoId);

  if (updateError) {
    throw new Error(
      `Fallo al guardar los campos estructurados: ${updateError.message}`,
    );
  }

  const { error: deleteError } = await supabase
    .from("amparos")
    .delete()
    .eq("contrato_id", contratoId);

  if (deleteError) {
    throw new Error(`Fallo al reemplazar amparos: ${deleteError.message}`);
  }

  const coverageMapping = mapExtractionToCoverageMapping(extraction, {
    contratoId,
    valorContrato: extraction.valor_contrato.valor_numerico,
    baseCalculoAmparos: extraction.valor_contrato.valor_numerico,
    fechaInicio: extraction.fecha_inicio.valor,
    fechaFin: extraction.fecha_fin.valor,
  });
  const coverageRows = coverageMapping.rows;

  logCoverageRowsForDevelopment(coverageMapping);

  if (coverageRows.length === 0) {
    return;
  }

  const { error: insertError } = await supabase
    .from("amparos")
    .insert(coverageRows);

  if (insertError) {
    throw new Error(`Fallo al guardar amparos: ${insertError.message}`);
  }
}

async function processAmendmentExtraction({
  contratoId,
  documentoId,
  extractedText,
  openAiContext,
  deployment,
}: {
  contratoId: DbInt8;
  documentoId: DbInt8;
  extractedText: string;
  openAiContext: string;
  deployment: string;
}) {
  const supabase = getSupabaseAdmin();

  logExtractionAttemptForDevelopment({
    deployment,
    phase: "amendment_start",
  });

  const result = await extractStructuredAmendment(deployment, openAiContext);

  logAmendmentResultForDevelopment(result);

  await insertAmendmentExtractionLog({
    contractId: contratoId,
    documentId: documentoId,
    extractedText,
    result,
    resultado: getAmendmentExtractionLogResult(result.extraction),
  });

  const modificationPayload = mapAmendmentToModification(
    result.extraction,
    contratoId,
    documentoId,
  );
  const { data: modification, error: modificationError } = await supabase
    .from("modificaciones_contractuales")
    .insert(modificationPayload)
    .select("id")
    .single();

  if (modificationError || !modification) {
    throw new Error(
      `Fallo al guardar la modificación contractual: ${modificationError?.message ?? "sin detalle"}`,
    );
  }

  const { data: contract, error: contractError } = await supabase
    .from("contratos")
    .select("valor_contrato,base_calculo_amparos,fecha_inicio,fecha_fin")
    .eq("id", contratoId)
    .single();

  if (contractError || !contract) {
    throw new Error(
      `Fallo al consultar contrato base para amparos del otrosí: ${contractError?.message ?? "sin detalle"}`,
    );
  }

  const coverageMapping = mapExtractionToCoverageMapping(
    { garantias: result.extraction.garantias },
    {
      contratoId,
      modificacionId: modification.id,
      valorContrato: contract.valor_contrato,
      baseCalculoAmparos: contract.base_calculo_amparos,
      fechaInicio: contract.fecha_inicio,
      fechaFin: contract.fecha_fin,
    },
  );

  logCoverageRowsForDevelopment(coverageMapping);

  if (coverageMapping.rows.length > 0) {
    const { error: coverageError } = await supabase
      .from("amparos")
      .insert(coverageMapping.rows);

    if (coverageError) {
      throw new Error(
        `Fallo al guardar amparos asociados al otrosí: ${coverageError.message}`,
      );
    }
  }

  await updateContractOrThrow(contratoId, {
    estado: "pendiente_validacion",
    mensaje_error: null,
    fecha_procesamiento: new Date().toISOString(),
  });
}

export function mapExtractionToContractUpdate(extraction: unknown): ContractUpdate {
  const record = asRecord(extraction);
  const valorContrato = asRecord(record.valor_contrato);
  const contratante = asRecord(record.contratante);
  const contratista = asRecord(record.contratista);
  const normalizedContractValue = normalizeNumber(
    valorContrato.valor_numerico ?? valorContrato.valor ?? record.valor_contrato,
  );

  return {
    numero_contrato: normalizeText(record.numero_contrato),
    objeto: normalizeText(record.objeto),
    tipo_contrato: normalizeContractType(record.tipo_contrato),
    valor_contrato: normalizedContractValue,
    base_calculo_amparos: normalizedContractValue,
    base_calculo_incluye_iva: inferBaseIncludesIva(valorContrato.fuente),
    moneda: normalizeCurrency(valorContrato.moneda ?? record.moneda),
    fecha_inicio: normalizeDate(record.fecha_inicio),
    fecha_fin: normalizeDate(record.fecha_fin),
    plazo: normalizeText(record.plazo),
    contratante: normalizeText(
      contratante.nombre ?? contratante.valor ?? record.contratante,
    ),
    contratante_nit: normalizeText(contratante.nit),
    contratista: normalizeText(
      contratista.nombre ?? contratista.valor ?? record.contratista,
    ),
    contratista_nit: normalizeText(contratista.nit),
    estado: "pendiente_validacion",
    extraido_ia: true,
    fecha_procesamiento: new Date().toISOString(),
    version_prompt: PROMPT_VERSION,
  };
}

export function mapExtractionToCoverageRows(
  extraction: unknown,
  contract: {
    contratoId: DbInt8;
    modificacionId?: DbInt8 | null;
    valorContrato: unknown;
    baseCalculoAmparos?: unknown;
    fechaInicio: unknown;
    fechaFin: unknown;
  },
): CoverageInsert[] {
  return mapExtractionToCoverageMapping(extraction, contract).rows;
}

function mapExtractionToCoverageMapping(
  extraction: unknown,
  contract: {
    contratoId: DbInt8;
    modificacionId?: DbInt8 | null;
    valorContrato: unknown;
    baseCalculoAmparos?: unknown;
    fechaInicio: unknown;
    fechaFin: unknown;
  },
): CoverageMappingResult {
  const record = asRecord(extraction);
  const garantias = prepareCoverageRecords(
    Array.isArray(record.garantias) ? record.garantias : [],
  );
  const contractContext = {
    valorContrato: normalizeNumber(contract.valorContrato),
    baseCalculoAmparos: normalizeNumber(contract.baseCalculoAmparos) ??
      normalizeNumber(contract.valorContrato),
    fechaInicio: normalizeDate(contract.fechaInicio),
    fechaFin: normalizeDate(contract.fechaFin),
  };
  const advanceInfo = extractAdvanceInfoFromExtraction(
    record,
    contractContext.valorContrato,
    contractContext.baseCalculoAmparos,
  );
  const result: CoverageMappingResult = {
    rows: [],
    skipped: [],
  };

  garantias.forEach((rawCoverage, index) => {
    const coverageRecord = asRecord(rawCoverage);
    const tipoAmparo = normalizeText(
      coverageRecord.tipo_amparo,
      "Amparo sin clasificar",
    ) ?? "Amparo sin clasificar";
    const missingName = tipoAmparo === "Amparo sin clasificar";
    const fixedAmount = normalizeNumber(
      coverageRecord.cuantia_fija ?? coverageRecord.valor_asegurado,
    );
    const normalizedInput = {
      tipo_amparo: tipoAmparo,
      porcentaje: normalizePercentage(coverageRecord.porcentaje),
      cuantia_fija: fixedAmount,
      valor_asegurado: null,
      tipo_vigencia: normalizeEnum(
        coverageRecord.tipo_vigencia,
        COVERAGE_VALIDITY_TYPES,
        null,
      ),
      base_vigencia: normalizeEnum(
        coverageRecord.base_vigencia,
        COVERAGE_VALIDITY_BASES,
        null,
      ),
      dias_adicionales: normalizeInteger(coverageRecord.dias_adicionales),
      fecha_desde: normalizeDate(coverageRecord.fecha_desde),
      fecha_hasta: normalizeDate(coverageRecord.fecha_hasta),
      fuente_texto: normalizeText(coverageRecord.fuente_texto),
      fuente_pagina: normalizeInteger(coverageRecord.fuente_pagina),
      subamparos: normalizeSubcoverages(coverageRecord.subamparos),
      confianza:
        normalizeEnum(coverageRecord.confianza, CONFIDENCE_VALUES, "baja") ??
        "baja",
      ...(isAdvanceCoverageRecord(coverageRecord)
        ? {
            valor_anticipo: advanceInfo.valorAnticipo,
            porcentaje_anticipo: advanceInfo.porcentajeAnticipo,
            anticipo_base_incluye_iva: advanceInfo.baseIncluyeIva,
          }
        : {}),
    };

    if (isWeakCoverageInference(normalizedInput)) {
      result.skipped.push({
        index,
        tipo_amparo: missingName ? null : tipoAmparo,
        reason:
          "Inferencia débil sin fuente, página ni regla suficiente; se conserva como alerta del JSON original.",
        fuente_pagina: normalizedInput.fuente_pagina,
        fuente_texto: normalizedInput.fuente_texto,
      });
      return;
    }

    const normalized = normalizeCoverage(normalizedInput, {
      valorContrato: contractContext.valorContrato,
      baseCalculoAmparos: contractContext.baseCalculoAmparos,
      valorAnticipo: advanceInfo.valorAnticipo,
      porcentajeAnticipo: advanceInfo.porcentajeAnticipo,
      anticipoBaseIncluyeIva: advanceInfo.baseIncluyeIva,
      fechaInicio: contractContext.fechaInicio,
      fechaFin: contractContext.fechaFin,
    });
    const motivoRevision = [
      normalized.motivo_revision,
      missingName ? "Falta nombre del amparo." : null,
      normalizedInput.fuente_texto ? null : "Falta fuente textual del amparo.",
      normalizedInput.fuente_pagina ? null : "Falta página fuente del amparo.",
      hasPerPersonCondition(normalizedInput.fuente_texto)
        ? "La cuantía aplica por empleado, persona o evento; requiere revisión humana."
        : null,
    ]
      .filter(Boolean)
      .join(" ");

    result.rows.push(validateCoverageRow({
      contrato_id: contract.contratoId,
      modificacion_id: contract.modificacionId ?? null,
      tasa_referencia_id: null,
      tipo_amparo: normalized.tipo_amparo,
      porcentaje: normalized.porcentaje,
      cuantia_fija: normalized.cuantia_fija,
      valor_base_calculo: normalized.valor_base_calculo,
      modo_calculo: normalized.modo_calculo,
      valor_asegurado: normalized.valor_asegurado,
      tasa: normalized.tasa,
      dias_vigencia: normalized.dias_vigencia,
      iva_porcentaje: normalized.iva_porcentaje,
      prima_neta: normalized.prima_neta,
      impuesto: normalized.impuesto,
      prima_total: normalized.prima_total,
      tasa_manual: normalized.tasa_manual,
      tipo_vigencia: normalized.tipo_vigencia,
      base_vigencia: normalized.base_vigencia,
      fecha_desde: normalized.fecha_desde,
      fecha_hasta: normalized.fecha_hasta,
      dias_adicionales: normalized.dias_adicionales,
      fuente_pagina: normalized.fuente_pagina,
      fuente_texto: normalized.fuente_texto,
      confianza: normalized.confianza,
      requiere_revision:
        normalized.requiere_revision ||
        missingName ||
        !normalizedInput.fuente_texto ||
        !normalizedInput.fuente_pagina ||
        hasPerPersonCondition(normalizedInput.fuente_texto),
      motivo_revision: motivoRevision || null,
      subamparos: normalized.subamparos as Json,
    }));
  });

  return result;
}

function validateContractUpdatePayload(update: ContractUpdate): {
  payload: ContractUpdate;
  report: NormalizationReport;
} {
  const report: NormalizationReport = {
    corrected: [],
    discarded: [],
    fieldTypes: {},
  };
  const tipoContrato = normalizeContractType(update.tipo_contrato);
  trackNormalization("tipo_contrato", update.tipo_contrato, tipoContrato, report);

  const payload: ContractUpdate = {
    numero_contrato: normalizeNullableTextField("numero_contrato", update, report),
    objeto: normalizeNullableTextField("objeto", update, report),
    tipo_contrato: tipoContrato,
    valor_contrato: normalizeNullableNumberField(
      "valor_contrato",
      update,
      report,
    ),
    base_calculo_amparos: normalizeNullableNumberField(
      "base_calculo_amparos",
      update,
      report,
    ),
    base_calculo_incluye_iva: normalizeNullableBooleanField(
      "base_calculo_incluye_iva",
      update,
      report,
    ),
    moneda: normalizeRequiredCurrencyField(update.moneda, report),
    fecha_inicio: normalizeNullableDateField("fecha_inicio", update, report),
    fecha_fin: normalizeNullableDateField("fecha_fin", update, report),
    plazo: normalizeNullableTextField("plazo", update, report),
    contratante: normalizeNullableTextField("contratante", update, report),
    contratante_nit: normalizeNullableTextField(
      "contratante_nit",
      update,
      report,
    ),
    contratista: normalizeNullableTextField("contratista", update, report),
    contratista_nit: normalizeNullableTextField(
      "contratista_nit",
      update,
      report,
    ),
    estado:
      normalizeEnum(update.estado, CONTRACT_STATES, "pendiente_validacion") ??
      "pendiente_validacion",
    extraido_ia: normalizeRequiredBooleanField(update.extraido_ia, report),
    fecha_procesamiento: normalizeTimestamp(
      update.fecha_procesamiento,
      "fecha_procesamiento",
      report,
    ),
    version_prompt:
      normalizeText(update.version_prompt, PROMPT_VERSION) ?? PROMPT_VERSION,
  };

  for (const [field, value] of Object.entries(payload)) {
    report.fieldTypes[field] = getValueType(value);

    if (typeof value === "undefined") {
      report.discarded.push(`${field}: undefined descartado`);
      delete (payload as Record<string, unknown>)[field];
    }

    if (typeof value === "number" && Number.isNaN(value)) {
      report.corrected.push(`${field}: NaN convertido a null`);
      (payload as Record<string, unknown>)[field] = null;
    }
  }

  return { payload, report };
}

function getExtractionLogResult(extraction: AIExtraction): "exito" | "parcial" {
  return extraction.alertas.length > 0 ||
    extraction.campos_no_encontrados.length > 0 ||
    getCriticalMissingFields(extraction).length > 0
    ? "parcial"
    : "exito";
}

function getExtractionQualityScore(extraction: AIExtraction) {
  return (
    getCriticalMissingFields(extraction).length * 100 +
    countLowConfidenceFields(extraction) * 8 +
    extraction.campos_no_encontrados.length * 4 +
    extraction.alertas.length * 2
  );
}

function getAmendmentExtractionLogResult(
  extraction: AmendmentExtraction,
): "exito" | "parcial" {
  return extraction.alertas.length > 0 ||
    extraction.campos_no_encontrados.length > 0 ||
    extraction.requiere_revision
    ? "parcial"
    : "exito";
}

function mapAmendmentToModification(
  extraction: AmendmentExtraction,
  contratoId: DbInt8,
  documentoId: DbInt8,
): Database["public"]["Tables"]["modificaciones_contractuales"]["Insert"] {
  const reviewReasons = [
    extraction.motivo_revision,
    extraction.numero_modificacion.valor ? null : "Falta número de otrosí.",
    extraction.tipo_modificacion.valor ? null : "Falta tipo de modificación.",
    extraction.valor_adicion.valor === null &&
    extraction.dias_prorroga.valor === null &&
    extraction.fecha_hasta.valor === null
      ? "No se detectó adición, prórroga ni nueva fecha de terminación."
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    contrato_id: contratoId,
    documento_id: documentoId,
    numero_modificacion: normalizeText(extraction.numero_modificacion.valor),
    tipo_modificacion: normalizeText(extraction.tipo_modificacion.valor),
    valor_adicion: normalizeNumber(extraction.valor_adicion.valor),
    valor_contrato_acumulado: normalizeNumber(
      extraction.valor_contrato_acumulado.valor,
    ),
    fecha_desde: normalizeDate(extraction.fecha_desde.valor),
    fecha_hasta: normalizeDate(extraction.fecha_hasta.valor),
    dias_prorroga: normalizeInteger(extraction.dias_prorroga.valor),
    fuente_pagina:
      extraction.fuente_pagina ??
      extraction.numero_modificacion.pagina ??
      extraction.tipo_modificacion.pagina,
    fuente_texto:
      normalizeText(extraction.fuente_texto) ??
      normalizeText(extraction.numero_modificacion.fuente) ??
      normalizeText(extraction.tipo_modificacion.fuente),
    confianza: extraction.confianza,
    requiere_revision: extraction.requiere_revision || Boolean(reviewReasons),
    motivo_revision: reviewReasons || null,
  };
}

function getCriticalMissingFields(extraction: AIExtraction) {
  const missing: string[] = [];

  if (normalizeNumber(extraction.valor_contrato.valor_numerico) === null) {
    missing.push("valor_contrato");
  }

  if (normalizeText(extraction.plazo.valor) === null) {
    missing.push("plazo");
  }

  if (normalizeDate(extraction.fecha_inicio.valor) === null) {
    missing.push("fecha_inicio");
  }

  if (normalizeDate(extraction.fecha_fin.valor) === null) {
    missing.push("fecha_fin");
  }

  if (!extraction.garantias.some(hasUsefulCoverageEvidence)) {
    missing.push("garantias/amparos");
  }

  return missing;
}

function applyDeterministicDateFallbacksToResult(
  result: OpenAIExtractionResult,
  extractedText: string,
): OpenAIExtractionResult {
  return {
    ...result,
    extraction: applyDeterministicDateFallbacks(result.extraction, extractedText),
  };
}

function applyDeterministicDateFallbacks(
  extraction: AIExtraction,
  extractedText: string,
): AIExtraction {
  const actaInicioDependency = findActaInicioDependencyCandidate(extractedText);
  const candidate = findContractDurationDateCandidate(extractedText);
  let baseExtraction = extraction;

  if (actaInicioDependency && !actaInicioDependency.startDate) {
    const actaDuration = candidate?.duration ??
      extractDuration(actaInicioDependency.source);
    const plazoFromActa = durationToPlazoText(
      actaDuration,
      "contados a partir de la fecha de suscripción del Acta de Inicio",
    );

    baseExtraction = {
      ...extraction,
      fecha_inicio: {
        ...extraction.fecha_inicio,
        valor: null,
        confianza: "baja",
        pagina: actaInicioDependency.pageNumber,
        fuente: actaInicioDependency.source,
      },
      fecha_fin: {
        ...extraction.fecha_fin,
        valor: null,
        confianza: "baja",
        pagina: actaInicioDependency.pageNumber,
        fuente: actaInicioDependency.source,
      },
      plazo: normalizeText(extraction.plazo.valor)
        ? extraction.plazo
        : {
            valor: plazoFromActa,
            confianza: plazoFromActa ? "media" : "baja",
            pagina: actaInicioDependency.pageNumber,
            fuente: actaInicioDependency.source,
          },
      alertas: [
        ...extraction.alertas,
        "El plazo depende del Acta de Inicio; ingrese la fecha de inicio para calcular fecha fin.",
      ],
    };
  }

  if (!candidate) {
    return baseExtraction;
  }

  const next: AIExtraction = {
    ...baseExtraction,
    fecha_inicio: { ...baseExtraction.fecha_inicio },
    fecha_fin: { ...baseExtraction.fecha_fin },
    alertas: [...baseExtraction.alertas],
    campos_no_encontrados: [...baseExtraction.campos_no_encontrados],
  };
  const currentStart = normalizeDate(next.fecha_inicio.valor);
  const startDate = currentStart ?? candidate.startDate;

  if (!currentStart && candidate.startDate) {
    next.fecha_inicio = {
      valor: candidate.startDate,
      confianza: "media",
      pagina: candidate.pageNumber,
      fuente: candidate.source,
    };
    next.alertas.push(
      "fecha_inicio derivada determinísticamente desde cláusula de duración/suscripción.",
    );
  }

  if (!normalizeDate(next.fecha_fin.valor) && startDate && candidate.duration) {
    const derivedEndDate = addDuration(startDate, candidate.duration);

    if (derivedEndDate) {
      next.fecha_fin = {
        valor: derivedEndDate,
        confianza: "media",
        pagina: candidate.pageNumber,
        fuente: candidate.source,
      };
      next.alertas.push(
        "fecha_fin derivada determinísticamente desde fecha de inicio y plazo contractual.",
      );
    }
  }

  next.campos_no_encontrados = next.campos_no_encontrados.filter((field) => {
    const normalized = normalizeText(field);

    if (next.fecha_inicio.valor && normalized === "fecha_inicio") {
      return false;
    }

    if (next.fecha_fin.valor && normalized === "fecha_fin") {
      return false;
    }

    return true;
  });

  return next;
}

function findContractDurationDateCandidate(text: string) {
  const pagePattern = /--- Página (\d+) ---\n([\s\S]*?)(?=\n\n--- Página \d+ ---|$)/g;
  const pages = Array.from(text.matchAll(pagePattern));

  for (const match of pages) {
    const pageNumber = Number(match[1]);
    const pageText = match[2] ?? "";
    const normalized = normalizeForDateSearch(pageText);

    if (!containsDurationDateSignal(normalized)) {
      continue;
    }

    const dependsOnActaInicio = normalized.includes("acta de inicio");
    const startDate = dependsOnActaInicio
      ? extractActaInicioDate(pageText)
      : extractFirstSpanishDate(pageText);
    const duration = extractDuration(pageText);

    if (startDate || duration) {
      return {
        pageNumber: Number.isFinite(pageNumber) ? pageNumber : null,
        startDate,
        duration,
        source: extractRelevantDateSentence(pageText),
      };
    }
  }

  return null;
}

function findActaInicioDependencyCandidate(text: string) {
  const pagePattern = /--- Página (\d+) ---\n([\s\S]*?)(?=\n\n--- Página \d+ ---|$)/g;
  const pages = Array.from(text.matchAll(pagePattern));

  for (const match of pages) {
    const pageNumber = Number(match[1]);
    const pageText = match[2] ?? "";
    const normalized = normalizeForDateSearch(pageText);

    if (
      normalized.includes("acta de inicio") &&
      (normalized.includes("a partir") ||
        normalized.includes("contado") ||
        normalized.includes("contados") ||
        normalized.includes("plazo") ||
        normalized.includes("duracion"))
    ) {
      return {
        pageNumber: Number.isFinite(pageNumber) ? pageNumber : null,
        startDate: extractActaInicioDate(pageText),
        source: extractRelevantDateSentence(pageText),
      };
    }
  }

  return null;
}

function extractActaInicioDate(text: string) {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?;:])\s+/)
    .filter((sentence) =>
      normalizeForDateSearch(sentence).includes("acta de inicio"),
    );

  for (const sentence of sentences) {
    const date = extractFirstSpanishDate(sentence);

    if (date) {
      return date;
    }
  }

  return null;
}

function containsDurationDateSignal(text: string) {
  return (
    (text.includes("duracion") ||
      text.includes("plazo") ||
      text.includes("vigencia")) &&
    (text.includes("a partir de") ||
      text.includes("contado a partir") ||
      text.includes("contados a partir") ||
      text.includes("suscripcion") ||
      text.includes("acta de inicio"))
  );
}

function extractFirstSpanishDate(text: string) {
  const writtenDate = text.match(
    /\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+de\s+(\d{4})\b/i,
  );

  if (writtenDate) {
    return toIsoDate(
      Number(writtenDate[1]),
      getSpanishMonthNumber(writtenDate[2]),
      Number(writtenDate[3]),
    );
  }

  const numericDate = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);

  if (numericDate) {
    return toIsoDate(
      Number(numericDate[1]),
      Number(numericDate[2]),
      Number(numericDate[3]),
    );
  }

  return null;
}

function extractDuration(text: string) {
  const normalized = normalizeForDateSearch(text);
  const parenthesized = normalized.match(
    /\((\d+)\)\s*(anos?|mes(?:es)?|dias?)/,
  );

  if (parenthesized) {
    return durationFromMatch(Number(parenthesized[1]), parenthesized[2]);
  }

  const numeric = normalized.match(/\b(\d+)\s*(anos?|mes(?:es)?|dias?)\b/);

  if (numeric) {
    return durationFromMatch(Number(numeric[1]), numeric[2]);
  }

  if (/\bun ano\b/.test(normalized)) {
    return { years: 1, months: 0, days: 0 };
  }

  if (/\bdoce meses\b/.test(normalized)) {
    return { years: 0, months: 12, days: 0 };
  }

  if (/\bdoscientos cuarenta\b/.test(normalized) && /\bdias?\b/.test(normalized)) {
    return { years: 0, months: 0, days: 240 };
  }

  return null;
}

function durationFromMatch(value: number, unit: string) {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  if (unit.startsWith("ano")) {
    return { years: value, months: 0, days: 0 };
  }

  if (unit.startsWith("mes")) {
    return { years: 0, months: value, days: 0 };
  }

  return { years: 0, months: 0, days: value };
}

function addDuration(
  date: string,
  duration: { years: number; months: number; days: number },
) {
  const parsedDate = new Date(`${date}T00:00:00.000Z`);

  if (!Number.isFinite(parsedDate.getTime())) {
    return null;
  }

  parsedDate.setUTCFullYear(parsedDate.getUTCFullYear() + duration.years);
  parsedDate.setUTCMonth(parsedDate.getUTCMonth() + duration.months);
  parsedDate.setUTCDate(parsedDate.getUTCDate() + duration.days);

  return parsedDate.toISOString().slice(0, 10);
}

function durationToPlazoText(
  duration: { years: number; months: number; days: number } | null,
  suffix: string,
) {
  if (!duration) {
    return null;
  }

  const parts = [
    duration.years > 0
      ? `${duration.years} ${duration.years === 1 ? "año" : "años"}`
      : null,
    duration.months > 0
      ? `${duration.months} ${duration.months === 1 ? "mes" : "meses"}`
      : null,
    duration.days > 0
      ? `${duration.days} ${duration.days === 1 ? "día" : "días"}`
      : null,
  ].filter(Boolean);

  return parts.length > 0 ? `${parts.join(" ")} ${suffix}` : null;
}

function getSpanishMonthNumber(month: string) {
  const months: Record<string, number> = {
    enero: 1,
    febrero: 2,
    marzo: 3,
    abril: 4,
    mayo: 5,
    junio: 6,
    julio: 7,
    agosto: 8,
    septiembre: 9,
    setiembre: 9,
    octubre: 10,
    noviembre: 11,
    diciembre: 12,
  };

  return months[month.toLowerCase()] ?? null;
}

function toIsoDate(day: number, month: number | null, year: number) {
  if (!month || !Number.isFinite(day) || !Number.isFinite(year)) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function extractRelevantDateSentence(text: string) {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?;:])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const selected =
    sentences.find((sentence) =>
      containsDurationDateSignal(normalizeForDateSearch(sentence)),
    ) ?? sentences[0] ?? text.slice(0, 600);

  return selected.slice(0, 900);
}

function normalizeForDateSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function hasUsefulCoverageEvidence(
  coverage: AIExtraction["garantias"][number],
) {
  const candidate = {
    tipo_amparo: normalizeText(coverage.tipo_amparo, "Amparo sin clasificar") ??
      "Amparo sin clasificar",
    porcentaje: normalizePercentage(coverage.porcentaje),
    cuantia_fija: normalizeNumber(
      coverage.cuantia_fija ?? coverage.valor_asegurado,
    ),
    valor_asegurado: null,
    tipo_vigencia: normalizeEnum(
      coverage.tipo_vigencia,
      COVERAGE_VALIDITY_TYPES,
      null,
    ),
    base_vigencia: normalizeEnum(
      coverage.base_vigencia,
      COVERAGE_VALIDITY_BASES,
      null,
    ),
    dias_adicionales: normalizeInteger(coverage.dias_adicionales),
    fecha_desde: normalizeDate(coverage.fecha_desde),
    fecha_hasta: normalizeDate(coverage.fecha_hasta),
    fuente_texto: normalizeText(coverage.fuente_texto),
    fuente_pagina: normalizeInteger(coverage.fuente_pagina),
    confianza: normalizeEnum(coverage.confianza, CONFIDENCE_VALUES, "baja") ??
      "baja",
  };

  return !isWeakCoverageInference(candidate);
}

function normalizeContractType(value: unknown) {
  const record = asRecord(value);

  return normalizeEnum(
    record.valor ?? record.value ?? value,
    CONTRACT_TYPE_VALUES,
    null,
  );
}

function isWeakCoverageInference(coverage: {
  porcentaje: number | null;
  cuantia_fija: number | null;
  tipo_vigencia: string | null;
  base_vigencia: string | null;
  dias_adicionales: number | null;
  fecha_desde: string | null;
  fecha_hasta: string | null;
  fuente_texto: string | null;
  fuente_pagina: number | null;
  confianza: string | null;
}) {
  const hasSource =
    normalizeText(coverage.fuente_texto) !== null ||
    coverage.fuente_pagina !== null;

  if (!hasSource) {
    return true;
  }

  const hasRule =
    coverage.porcentaje !== null ||
    coverage.cuantia_fija !== null ||
    coverage.tipo_vigencia !== null ||
    coverage.base_vigencia !== null ||
    coverage.dias_adicionales !== null ||
    coverage.fecha_desde !== null ||
    coverage.fecha_hasta !== null;

  return coverage.confianza === "baja" && !hasRule;
}

function hasPerPersonCondition(source: string | null) {
  const normalized = normalizeText(source);

  if (!normalized) {
    return false;
  }

  return [
    "por empleado",
    "por persona",
    "por trabajador",
    "por evento",
    "cada empleado",
    "cada persona",
  ].some((marker) => normalized.toLowerCase().includes(marker));
}

function extractAdvanceInfoFromExtraction(
  extraction: Record<string, unknown>,
  contractValue: number | null,
  confirmedBase: number | null,
) {
  const text = collectStrings(extraction).join(" ");
  const normalized = normalizeForLooseSearch(text);
  const porcentajeAnticipo = extractPercentageNearAdvance(normalized);
  const baseIncluyeIva = inferAdvanceBaseIncludesIva(normalized);
  const subtotal = extractAmountNearMarkers(text, [
    "subtotal",
    "valor sin iva",
    "antes de iva",
    "sin incluir iva",
  ]);
  const fixedAdvance = extractFixedAdvanceAmount(text);
  let base =
    baseIncluyeIva === false
      ? subtotal ?? (contractValue === null ? null : roundMoney(contractValue / 1.19))
      : baseIncluyeIva === true
        ? contractValue
        : confirmedBase ?? contractValue;

  if (baseIncluyeIva === false && subtotal !== null) {
    base = subtotal;
  }

  const valorAnticipo =
    porcentajeAnticipo !== null && base !== null
      ? roundMoney(base * porcentajeAnticipo)
      : fixedAdvance;

  return {
    valorAnticipo,
    porcentajeAnticipo,
    baseIncluyeIva,
  };
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStrings(item));
  }

  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap((item) => collectStrings(item));
  }

  return [];
}

function isAdvanceCoverageRecord(record: Record<string, unknown>) {
  const text = normalizeForLooseSearch(
    `${record.tipo_amparo ?? ""} ${record.fuente_texto ?? ""}`,
  );

  return (
    text.includes("buen manejo") ||
    text.includes("anticipo") ||
    text.includes("correcta inversion") ||
    text.includes("amortizacion del anticipo") ||
    text.includes("buen_manejo_anticipo")
  );
}

function extractPercentageNearAdvance(normalizedText: string) {
  const advanceSentences = normalizedText
    .split(/(?<=[.!?;:])\s+/)
    .filter((sentence) => sentence.includes("anticipo"));
  const preferredSentences = advanceSentences.filter((sentence) =>
    [
      "valor estimado",
      "sin incluir iva",
      "sin iva",
      "procedimiento de pago",
      "forma de pago",
      "pago anticipado",
      "anticipo del",
    ].some((marker) => sentence.includes(marker)),
  );
  const sentenceMatch =
    findAdvancePercentageCandidate(preferredSentences) ??
    findAdvancePercentageCandidate(advanceSentences);

  if (sentenceMatch !== null) {
    return sentenceMatch;
  }

  const advanceIndexes = Array.from(normalizedText.matchAll(/anticipo/g)).map(
    (match) => match.index ?? -1,
  );

  for (const advanceIndex of advanceIndexes) {
    const searchArea = normalizedText.slice(
      Math.max(0, advanceIndex - 700),
      advanceIndex + 1200,
    );
    const value = findAdvancePercentageCandidate([searchArea]);

    if (value !== null) {
      return value;
    }
  }

  return findAdvancePercentageCandidate([normalizedText]);
}

function findAdvancePercentageCandidate(texts: string[]) {
  const candidates = texts
    .map((text) => extractPercentageFromText(text))
    .filter((value): value is number => value !== null);

  return candidates.find((value) => value > 0 && value < 1) ?? null;
}

function extractPercentageFromText(text: string) {
  const numeric = text.match(/(\d+(?:[.,]\d+)?)\s*%/);

  if (numeric) {
    const value = normalizeNumber(numeric[1]);
    return value === null ? null : value / 100;
  }

  if (text.includes("veinte por ciento")) {
    return 0.2;
  }

  if (text.includes("treinta por ciento")) {
    return 0.3;
  }

  if (text.includes("cincuenta por ciento")) {
    return 0.5;
  }

  if (text.includes("cien por ciento")) {
    return 1;
  }

  return null;
}

function inferAdvanceBaseIncludesIva(normalizedText: string) {
  if (
    normalizedText.includes("sin incluir iva") ||
    normalizedText.includes("sin iva") ||
    normalizedText.includes("antes de iva") ||
    normalizedText.includes("no incluye iva")
  ) {
    return false;
  }

  if (
    normalizedText.includes("incluido iva") ||
    normalizedText.includes("iva incluido") ||
    normalizedText.includes("incluye iva")
  ) {
    return true;
  }

  return null;
}

function extractAmountNearMarkers(text: string, markers: string[]) {
  const normalized = normalizeForLooseSearch(text);
  const amounts: number[] = [];
  const sentences = text.replace(/\n+/g, ". ").split(/(?<=[.!?;:])\s+/);

  for (const marker of markers) {
    const sentence = sentences.find((item) =>
      normalizeForLooseSearch(item).includes(normalizeForLooseSearch(marker)),
    );
    const amount = sentence
      ? Array.from(sentence.matchAll(/\$\s*[\d.,]+/g))
          .map((match) => normalizeNumber(match[0]))
          .find((value): value is number => value !== null)
      : null;

    if (amount !== null && typeof amount !== "undefined") {
      return amount;
    }
  }

  markers.forEach((marker) => {
    const normalizedMarker = normalizeForLooseSearch(marker);
    let index = normalized.indexOf(normalizedMarker);

    while (index >= 0) {
      const slice = text.slice(Math.max(0, index - 180), index + 260);
      const matches = Array.from(slice.matchAll(/\$\s*[\d.,]+/g))
        .map((match) => normalizeNumber(match[0]))
        .filter((amount): amount is number => amount !== null);

      amounts.push(...matches);
      index = normalized.indexOf(normalizedMarker, index + normalizedMarker.length);
    }
  });

  return amounts.length > 0
    ? amounts.sort((left, right) => right - left)[0]
    : null;
}

function extractFixedAdvanceAmount(text: string) {
  const sentences = text
    .replace(/\n+/g, ". ")
    .split(/(?<=[.!?;:])\s+/)
    .filter((sentence) => {
      const normalized = normalizeForLooseSearch(sentence);
      return (
        normalized.includes("anticipo") ||
        normalized.includes("pago anticipado")
      );
    });

  for (const sentence of sentences) {
    const normalized = normalizeForLooseSearch(sentence);

    if (extractPercentageFromText(normalized) !== null) {
      continue;
    }

    const amount = Array.from(sentence.matchAll(/\$\s*[\d.,]+/g))
      .map((match) => normalizeNumber(match[0]))
      .find((value): value is number => value !== null);

    if (amount !== undefined) {
      return amount;
    }
  }

  return extractAmountNearMarkers(text, [
    "valor del anticipo",
    "suma entregada como anticipo",
    "anticipo por valor",
    "pago anticipado por valor",
  ]);
}

function normalizeForLooseSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function prepareCoverageRecords(rawCoverages: unknown[]) {
  const civilLiabilityRecords = rawCoverages
    .map((coverage, index) => ({
      index,
      record: asRecord(coverage),
    }))
    .filter(({ record }) => isCivilLiabilityRecord(record));

  if (civilLiabilityRecords.length === 0) {
    return rawCoverages;
  }

  const civilLiabilityIndexes = new Set(
    civilLiabilityRecords.map(({ index }) => index),
  );
  const nonCivilLiability = rawCoverages.filter(
    (_coverage, index) => !civilLiabilityIndexes.has(index),
  );
  const sourceRecords = selectCivilLiabilitySourceRecords(
    civilLiabilityRecords.map(({ record }) => record),
  );
  const mainRecord =
    sourceRecords.find((record) =>
      normalizeCivilLiabilityText(record).includes("responsabilidad civil"),
    ) ?? sourceRecords[0] ?? civilLiabilityRecords[0].record;
  const sourceText = sourceRecords
    .map((record) => normalizeText(record.fuente_texto))
    .filter(Boolean)
    .join(" ");
  const fuentePagina =
    sourceRecords
      .map((record) => normalizeInteger(record.fuente_pagina))
      .filter((page): page is number => page !== null)
      .sort((left, right) => left - right)[0] ?? null;
  const fixedAmount =
    sourceRecords
      .map((record) =>
        normalizeNumber(record.cuantia_fija ?? record.valor_asegurado),
      )
      .filter((amount): amount is number => amount !== null)
      .sort((left, right) => right - left)[0] ?? extractCurrencyAmount(sourceText);

  return [
    ...nonCivilLiability,
    {
      ...mainRecord,
      tipo_amparo: "responsabilidad_civil_extracontractual",
      porcentaje: null,
      cuantia_fija: fixedAmount,
      valor_asegurado: fixedAmount,
      tipo_vigencia: "contractual",
      base_vigencia: "fecha_fin_contrato",
      dias_adicionales: normalizeInteger(mainRecord.dias_adicionales) ?? 30,
      fuente_texto: sourceText || normalizeText(mainRecord.fuente_texto),
      fuente_pagina: fuentePagina ?? normalizeInteger(mainRecord.fuente_pagina),
      confianza:
        normalizeEnum(mainRecord.confianza, CONFIDENCE_VALUES, "media") ??
        "media",
    },
  ];
}

function selectCivilLiabilitySourceRecords(records: Record<string, unknown>[]) {
  const preferred = records.filter((record) => {
    const text = normalizeCivilLiabilityText(record);

    return (
      text.includes("poliza de responsabilidad civil extracontractual") ||
      text.includes("póliza de responsabilidad civil extracontractual") ||
      text.includes("responsabilidad civil extracontractual") ||
      (text.includes("cuantia") && text.includes("plo")) ||
      (text.includes("cuantía") && text.includes("plo")) ||
      (text.includes("300") && text.includes("plo"))
    );
  });

  return preferred.length > 0 ? preferred : records;
}

function isCivilLiabilityRecord(record: Record<string, unknown>) {
  const text = normalizeCivilLiabilityText(record);

  return (
    text.includes("responsabilidad civil") ||
    text.includes("extracontractual") ||
    text.includes("predios") ||
    text.includes("labores") ||
    text.includes("operaciones") ||
    text.includes("plo") ||
    text.includes("patronal") ||
    text.includes("civil cruzada") ||
    text.includes("vehiculos propios") ||
    text.includes("vehiculos no propios") ||
    text.includes("subcontrat")
  );
}

function normalizeCivilLiabilityText(record: Record<string, unknown>) {
  return (normalizeText(`${record.tipo_amparo ?? ""} ${record.fuente_texto ?? ""}`) ??
    "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeSubcoverages(value: unknown): CoverageSubamparo[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((subcoverage) => {
      const record = asRecord(subcoverage);
      const name = normalizeText(record.nombre);

      if (!name) {
        return null;
      }

      return {
        nombre: name,
        incluido: normalizeBoolean(record.incluido, true),
        porcentaje_sublimite: normalizeNumber(record.porcentaje_sublimite),
        valor_sublimite: normalizeNumber(record.valor_sublimite),
        origen:
          record.origen === "contrato"
            ? "contrato"
            : "regla_plantilla_afisec",
        calculable: normalizeBoolean(record.calculable, false),
        requiere_revision: normalizeBoolean(record.requiere_revision, true),
        fuente_texto: normalizeText(record.fuente_texto),
        fuente_pagina: normalizeInteger(record.fuente_pagina),
      } satisfies CoverageSubamparo;
    })
    .filter((subcoverage): subcoverage is CoverageSubamparo => subcoverage !== null);
}

function extractCurrencyAmount(source: string | null) {
  if (!source) {
    return null;
  }

  const amounts = Array.from(source.matchAll(/\$\s*[\d.,]+/g))
    .map((match) => normalizeNumber(match[0]))
    .filter((amount): amount is number => amount !== null);

  return amounts.length > 0
    ? amounts.sort((left, right) => right - left)[0]
    : null;
}

function validateCoverageRow(row: CoverageInsert): CoverageInsert {
  return {
    contrato_id: row.contrato_id,
    modificacion_id: row.modificacion_id ?? null,
    tasa_referencia_id: null,
    tipo_amparo: normalizeText(row.tipo_amparo, "Amparo sin clasificar")!,
    porcentaje: normalizePercentage(row.porcentaje),
    cuantia_fija: normalizeNumber(row.cuantia_fija),
    valor_base_calculo: normalizeNumber(row.valor_base_calculo),
    modo_calculo: normalizeText(row.modo_calculo),
    valor_asegurado: normalizeNumber(row.valor_asegurado),
    tasa: normalizeNumber(row.tasa),
    dias_vigencia: normalizeInteger(row.dias_vigencia),
    iva_porcentaje: normalizeNumber(row.iva_porcentaje) ?? 0.19,
    prima_neta: normalizeNumber(row.prima_neta),
    impuesto: normalizeNumber(row.impuesto),
    prima_total: normalizeNumber(row.prima_total),
    tasa_manual: normalizeBoolean(row.tasa_manual, false),
    tipo_vigencia: normalizeEnum(
      row.tipo_vigencia,
      COVERAGE_VALIDITY_TYPES,
      null,
    ),
    base_vigencia: normalizeEnum(
      row.base_vigencia,
      COVERAGE_VALIDITY_BASES,
      null,
    ),
    fecha_desde: normalizeDate(row.fecha_desde),
    fecha_hasta: normalizeDate(row.fecha_hasta),
    dias_adicionales: normalizeInteger(row.dias_adicionales),
    fuente_pagina: normalizeInteger(row.fuente_pagina),
    fuente_texto: normalizeText(row.fuente_texto),
    confianza: normalizeEnum(row.confianza, CONFIDENCE_VALUES, "baja"),
    requiere_revision: normalizeBoolean(row.requiere_revision, true),
    motivo_revision: normalizeText(row.motivo_revision),
    subamparos: (row.subamparos ?? []) as Json,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeNullableTextField(
  field: keyof ContractUpdate,
  update: ContractUpdate,
  report: NormalizationReport,
) {
  const original = update[field];
  const normalized = normalizeText(original);

  trackNormalization(field, original, normalized, report);
  return normalized;
}

function normalizeNullableNumberField(
  field: keyof ContractUpdate,
  update: ContractUpdate,
  report: NormalizationReport,
) {
  const original = update[field];
  const normalized = normalizeNumber(original);

  trackNormalization(field, original, normalized, report);
  return normalized;
}

function normalizeNullableDateField(
  field: keyof ContractUpdate,
  update: ContractUpdate,
  report: NormalizationReport,
) {
  const original = update[field];
  const normalized = normalizeDate(original);

  trackNormalization(field, original, normalized, report);
  return normalized;
}

function normalizeNullableBooleanField(
  field: keyof ContractUpdate,
  update: ContractUpdate,
  report: NormalizationReport,
) {
  const original = update[field];

  if (original === null || typeof original === "undefined") {
    trackNormalization(field, original, null, report);
    return null;
  }

  const normalized = normalizeBoolean(original, false);

  trackNormalization(field, original, normalized, report);
  return normalized;
}

function normalizeRequiredCurrencyField(
  value: unknown,
  report: NormalizationReport,
) {
  const normalized = normalizeCurrency(value);

  trackNormalization("moneda", value, normalized, report);

  if (normalized === "COP" && normalizeText(value) === null) {
    report.corrected.push("moneda: fallback COP aplicado");
  }

  return normalized;
}

function inferBaseIncludesIva(value: unknown) {
  const normalized = (normalizeText(value) ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (!normalized) {
    return null;
  }

  if (
    normalized.includes("incluido iva") ||
    normalized.includes("iva incluido") ||
    normalized.includes("incluye iva") ||
    normalized.includes("incluido el iva")
  ) {
    return true;
  }

  if (normalized.includes("sin iva") || normalized.includes("no incluye iva")) {
    return false;
  }

  return null;
}

function normalizeRequiredBooleanField(
  value: unknown,
  report: NormalizationReport,
) {
  const normalized = normalizeBoolean(value, false);

  trackNormalization("extraido_ia", value, normalized, report);

  if (typeof getExtractionValue(value) !== "boolean") {
    report.corrected.push("extraido_ia: convertido a boolean");
  }

  return normalized;
}

function normalizeTimestamp(
  value: unknown,
  field: keyof ContractUpdate,
  report: NormalizationReport,
) {
  const original = getExtractionValue(value);

  if (typeof original === "string") {
    const timestamp = new Date(original);

    if (Number.isFinite(timestamp.getTime())) {
      const normalized = timestamp.toISOString();
      trackNormalization(field, value, normalized, report);
      return normalized;
    }
  }

  const fallback = new Date().toISOString();
  trackNormalization(field, value, fallback, report);
  report.corrected.push(`${String(field)}: timestamp inválido reemplazado`);
  return fallback;
}

function normalizePercentage(value: unknown) {
  const normalized = normalizeNumber(value);

  if (normalized === null) {
    return null;
  }

  if (normalized > 1 && normalized <= 100) {
    return normalized / 100;
  }

  return normalized;
}

function trackNormalization(
  field: keyof ContractUpdate | keyof CoverageInsert,
  original: unknown,
  normalized: unknown,
  report: NormalizationReport,
) {
  const rawValue = getExtractionValue(original);
  const fieldName = String(field);

  if (typeof rawValue === "undefined") {
    report.discarded.push(`${fieldName}: undefined descartado`);
    return;
  }

  if (
    rawValue !== null &&
    typeof rawValue === "object" &&
    !Array.isArray(rawValue)
  ) {
    report.corrected.push(`${fieldName}: objeto anidado normalizado`);
    return;
  }

  if (typeof rawValue === "number" && !Number.isFinite(rawValue)) {
    report.corrected.push(`${fieldName}: número inválido normalizado`);
    return;
  }

  if (normalized !== rawValue) {
    report.corrected.push(
      `${fieldName}: ${getValueType(rawValue)} -> ${getValueType(normalized)}`,
    );
  }
}

function getValueType(value: unknown) {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  if (typeof value === "number" && Number.isNaN(value)) {
    return "NaN";
  }

  return typeof value;
}

async function insertExtractionLog({
  contractId,
  documentId,
  extractedText,
  result,
  resultado,
}: {
  contractId: DbInt8;
  documentId: DbInt8;
  extractedText: string;
  result: OpenAIExtractionResult;
  resultado: "exito" | "parcial";
}) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("extracciones").insert({
    contrato_id: contractId,
    documento_id: documentId,
    modelo: result.deployment,
    version_prompt: PROMPT_VERSION,
    texto_extraido: extractedText,
    json_original: (result.rawJson ?? {}) as Json,
    campos_no_encontrados: (result.extraction.campos_no_encontrados ??
      []) as Json,
    alertas: (result.extraction.alertas ?? []) as Json,
    tokens_entrada: result.usage.promptTokens ?? 0,
    tokens_salida: result.usage.completionTokens ?? 0,
    costo_estimado: 0,
    resultado,
    mensaje_error: null,
  });

  if (error) {
    console.error("Fallo al registrar la extracción.", error.message);
  }
}

async function insertAmendmentExtractionLog({
  contractId,
  documentId,
  extractedText,
  result,
  resultado,
}: {
  contractId: DbInt8;
  documentId: DbInt8;
  extractedText: string;
  result: OpenAIAmendmentExtractionResult;
  resultado: "exito" | "parcial";
}) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("extracciones").insert({
    contrato_id: contractId,
    documento_id: documentId,
    modelo: result.deployment,
    version_prompt: PROMPT_VERSION,
    texto_extraido: extractedText,
    json_original: (result.rawJson ?? {}) as Json,
    campos_no_encontrados: (result.extraction.campos_no_encontrados ??
      []) as Json,
    alertas: (result.extraction.alertas ?? []) as Json,
    tokens_entrada: result.usage.promptTokens ?? 0,
    tokens_salida: result.usage.completionTokens ?? 0,
    costo_estimado: 0,
    resultado,
    mensaje_error: null,
  });

  if (error) {
    console.error("Fallo al registrar la extracción del otrosí.", error.message);
  }
}

async function insertErrorExtractionLog(
  context: ProcessingContext,
  message: string,
) {
  const supabase = getSupabaseAdmin();

  const { error } = await supabase.from("extracciones").insert({
    contrato_id: context.contratoId,
    documento_id: context.documentoId,
    modelo: null,
    version_prompt: PROMPT_VERSION,
    texto_extraido: context.textoExtraido,
    json_original: {},
    campos_no_encontrados: [],
    alertas: [],
    tokens_entrada: 0,
    tokens_salida: 0,
    costo_estimado: 0,
    resultado: "error",
    mensaje_error: message,
  });

  if (error) {
    console.error(
      "Fallo al registrar la extracción fallida.",
      error.message,
      "Error original:",
      message,
    );
  }
}

async function markContractAsError(contratoId: DbInt8, message: string) {
  await updateContractOrThrow(contratoId, {
    estado: "error",
    mensaje_error: message,
    fecha_procesamiento: new Date().toISOString(),
  });
}

async function updateContractOrThrow(
  contratoId: DbInt8,
  update: Database["public"]["Tables"]["contratos"]["Update"],
) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("contratos")
    .update(update)
    .eq("id", contratoId);

  if (error) {
    throw new Error(`Fallo al actualizar el contrato: ${error.message}`);
  }
}

function logExtractionContextForDevelopment({
  totalPages,
  estimatedPageCount,
  fullText,
  openAiContext,
  openAiPages,
  pageDetails,
  truncated,
  documentType,
  fileName,
}: {
  totalPages: number;
  estimatedPageCount: number | null;
  fullText: string;
  openAiContext: string;
  openAiPages: number[];
  pageDetails: PageSelectionDetail[];
  truncated: boolean;
  documentType: string;
  fileName: string;
}) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  console.info("[Documento] archivo:", fileName);
  console.info("[Documento] tipo_documento:", documentType);
  if (documentType !== "contrato_base" && looksLikeBaseContract(fileName, fullText)) {
    console.warn(
      "[Documento] posible contrato base cargado con otro tipo. La extracción no cambia por tipo_documento, pero conviene corregir la clasificación manual.",
    );
  }
  console.info("[Document Intelligence] páginas extraídas:", totalPages);
  console.info(
    "[Document Intelligence] páginas estimadas en PDF:",
    estimatedPageCount ?? "no disponible",
  );
  console.info("[Document Intelligence] longitud total:", fullText.length);
  console.info(
    "[Document Intelligence] primeros 1000 caracteres:",
    fullText.slice(0, 1000),
  );
  console.info("[Azure OpenAI] páginas enviadas:", openAiPages.join(", "));
  console.info("[Azure OpenAI] contexto truncado:", truncated);
  console.info("[Azure OpenAI] longitud del contexto:", openAiContext.length);
  console.info(
    "[Azure OpenAI] razones por página:",
    pageDetails.map((page) => ({
      pagina: page.pageNumber,
      razones: page.reasons,
      keywords: page.keywords,
      prioridad: page.priorityScore,
      caracteres: page.charLength,
    })),
  );
  console.info(
    "[Azure OpenAI] primeros 1000 caracteres del contexto:",
    openAiContext.slice(0, 1000),
  );
}

function logExtractionAttemptForDevelopment({
  deployment,
  phase,
}: {
  deployment: string;
  phase: string;
}) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  console.info(`[Azure OpenAI] ${phase}:`, { deployment });
}

function logExtractionResultForDevelopment({
  result,
  criticalMissing,
  phase,
}: {
  result: OpenAIExtractionResult;
  criticalMissing: string[];
  phase: string;
}) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  console.info(`[Azure OpenAI] ${phase}:`, {
    deployment: result.deployment,
    resultado: getExtractionLogResult(result.extraction),
    tokens_entrada: result.usage.promptTokens ?? 0,
    tokens_salida: result.usage.completionTokens ?? 0,
    campos_criticos_faltantes: criticalMissing,
    campos_no_encontrados: result.extraction.campos_no_encontrados,
    alertas: result.extraction.alertas,
    garantias_detectadas: result.extraction.garantias.length,
  });
}

function logAmendmentResultForDevelopment(
  result: OpenAIAmendmentExtractionResult,
) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  console.info("[Azure OpenAI] amendment_result:", {
    deployment: result.deployment,
    resultado: getAmendmentExtractionLogResult(result.extraction),
    numero_modificacion: result.extraction.numero_modificacion.valor,
    tipo_modificacion: result.extraction.tipo_modificacion.valor,
    valor_adicion: result.extraction.valor_adicion.valor,
    valor_contrato_acumulado:
      result.extraction.valor_contrato_acumulado.valor,
    dias_prorroga: result.extraction.dias_prorroga.valor,
    garantias_detectadas: result.extraction.garantias.length,
    requiere_revision: result.extraction.requiere_revision,
  });
}

function logFallbackDecisionForDevelopment({
  triggered,
  reason,
  fallbackDeployment,
}: {
  triggered: boolean;
  reason: Record<string, unknown>;
  fallbackDeployment?: string;
}) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  console.info("[Azure OpenAI] decisión de fallback:", {
    triggered,
    fallbackDeployment: fallbackDeployment ?? null,
    reason,
  });
}

function logCoverageRowsForDevelopment(mapping: CoverageMappingResult) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  console.info(
    "[Supabase amparos.insert] filas preparadas:",
    mapping.rows.map((row) => ({
      tipo_amparo: row.tipo_amparo,
      porcentaje: row.porcentaje,
      cuantia_fija: row.cuantia_fija,
      valor_asegurado: row.valor_asegurado,
      valor_base_calculo: row.valor_base_calculo,
      modo_calculo: row.modo_calculo,
      tipo_vigencia: row.tipo_vigencia,
      base_vigencia: row.base_vigencia,
      dias_adicionales: row.dias_adicionales,
      dias_vigencia: row.dias_vigencia,
      tasa: row.tasa,
      iva_porcentaje: row.iva_porcentaje,
      prima_neta: row.prima_neta,
      impuesto: row.impuesto,
      prima_total: row.prima_total,
      tasa_manual: row.tasa_manual,
      fecha_desde: row.fecha_desde,
      fecha_hasta: row.fecha_hasta,
      fuente_pagina: row.fuente_pagina,
      confianza: row.confianza,
      requiere_revision: row.requiere_revision,
      motivo_revision: row.motivo_revision,
      subamparos: Array.isArray(row.subamparos)
        ? row.subamparos.map((subamparo) => {
            const record = asRecord(subamparo);

            return {
              nombre: record.nombre,
              calculable: record.calculable,
              origen: record.origen,
              valor_sublimite: record.valor_sublimite,
              requiere_revision: record.requiere_revision,
            };
          })
        : [],
    })),
  );
  console.info("[Supabase amparos.insert] inferencias omitidas:", mapping.skipped);
  console.info(
    "[Supabase amparos.insert] enviados a revisión humana:",
    mapping.rows
      .filter((row) => row.requiere_revision)
      .map((row) => ({
        tipo_amparo: row.tipo_amparo,
        motivo_revision: row.motivo_revision,
      })),
  );
}

function looksLikeBaseContract(fileName: string, fullText: string) {
  const sample = (normalizeText(`${fileName} ${fullText.slice(0, 3000)}`) ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return (
    sample.includes("contrato") ||
    sample.includes("clausula") ||
    sample.includes("objeto")
  );
}

function assertDocumentIntelligencePageCoverage({
  estimatedPageCount,
  extractedPageCount,
}: {
  estimatedPageCount: number | null;
  extractedPageCount: number;
}) {
  const missingPageCount =
    estimatedPageCount === null ? 0 : estimatedPageCount - extractedPageCount;
  const coverageRatio =
    estimatedPageCount === null ? 1 : extractedPageCount / estimatedPageCount;

  if (
    estimatedPageCount === null ||
    estimatedPageCount < 6 ||
    missingPageCount <= MAX_TOLERATED_MISSING_PAGES ||
    coverageRatio >= MIN_DOCUMENT_INTELLIGENCE_PAGE_COVERAGE_RATIO
  ) {
    return;
  }

  const message = [
    `Document Intelligence devolvió ${extractedPageCount} de aproximadamente ${estimatedPageCount} páginas del PDF.`,
    "La extracción se detuvo para evitar guardar una lectura incompleta como si fuera válida.",
    "Revisa si Azure Document Intelligence está usando un tier con límite de páginas, si el PDF subido está completo o si el servicio rechazó páginas posteriores.",
  ].join(" ");

  if (process.env.NODE_ENV === "development") {
    console.error("[Document Intelligence] cobertura insuficiente:", {
      estimatedPageCount,
      extractedPageCount,
      missingPageCount,
      coverageRatio,
      message,
    });
  }

  throw new Error(message);
}

function logContractUpdateForDevelopment(
  update: ContractUpdate,
  report: NormalizationReport,
) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  console.info("[Supabase contratos.update] payload:", update);
  console.info("[Supabase contratos.update] tipos:", report.fieldTypes);
  console.info("[Supabase contratos.update] corregidos:", report.corrected);
  console.info("[Supabase contratos.update] descartados:", report.discarded);
}
