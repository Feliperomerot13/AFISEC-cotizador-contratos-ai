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
  extractStructuredContract,
  InvalidAIJsonError,
  stringifyPages,
  type OpenAIExtractionResult,
  type PageSelectionDetail,
} from "@/lib/ai";
import { getErrorMessage } from "@/lib/api";
import type { AIExtraction } from "@/lib/schemas";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type ProcessingContext = {
  contratoId: string;
  documentoId: string | null;
  textoExtraido: string | null;
};

type ContractUpdate = Database["public"]["Tables"]["contratos"]["Update"];
type CoverageInsert = Database["public"]["Tables"]["amparos"]["Insert"];

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

export async function processContract(contratoId: string) {
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
    logExtractionAttemptForDevelopment({
      deployment: env.AZURE_OPENAI_DEPLOYMENT_PRIMARY,
      phase: "primary_start",
    });
    const primary = await extractStructuredContract(
      env.AZURE_OPENAI_DEPLOYMENT_PRIMARY,
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
      const fallback = await extractStructuredContract(
        env.AZURE_OPENAI_DEPLOYMENT_FALLBACK,
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
  contratoId: string,
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

export function mapExtractionToContractUpdate(extraction: unknown): ContractUpdate {
  const record = asRecord(extraction);
  const valorContrato = asRecord(record.valor_contrato);
  const contratante = asRecord(record.contratante);
  const contratista = asRecord(record.contratista);

  return {
    numero_contrato: normalizeText(record.numero_contrato),
    objeto: normalizeText(record.objeto),
    tipo_contrato: normalizeContractType(record.tipo_contrato),
    valor_contrato: normalizeNumber(
      valorContrato.valor_numerico ?? valorContrato.valor ?? record.valor_contrato,
    ),
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
    contratoId: string;
    valorContrato: unknown;
    fechaInicio: unknown;
    fechaFin: unknown;
  },
): CoverageInsert[] {
  return mapExtractionToCoverageMapping(extraction, contract).rows;
}

function mapExtractionToCoverageMapping(
  extraction: unknown,
  contract: {
    contratoId: string;
    valorContrato: unknown;
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
    fechaInicio: normalizeDate(contract.fechaInicio),
    fechaFin: normalizeDate(contract.fechaFin),
  };
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
      modificacion_id: null,
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
  const mainRecord =
    civilLiabilityRecords.find(({ record }) =>
      normalizeCivilLiabilityText(record).includes("responsabilidad civil"),
    )?.record ?? civilLiabilityRecords[0].record;
  const sourceText = civilLiabilityRecords
    .map(({ record }) => normalizeText(record.fuente_texto))
    .filter(Boolean)
    .join(" ");
  const fuentePagina =
    civilLiabilityRecords
      .map(({ record }) => normalizeInteger(record.fuente_pagina))
      .filter((page): page is number => page !== null)
      .sort((left, right) => left - right)[0] ?? null;
  const fixedAmount =
    civilLiabilityRecords
      .map(({ record }) =>
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
  contractId: string;
  documentId: string;
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

async function markContractAsError(contratoId: string, message: string) {
  await updateContractOrThrow(contratoId, {
    estado: "error",
    mensaje_error: message,
    fecha_procesamiento: new Date().toISOString(),
  });
}

async function updateContractOrThrow(
  contratoId: string,
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
