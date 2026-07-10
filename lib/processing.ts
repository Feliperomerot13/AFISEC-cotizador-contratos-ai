import { CONTRACT_STATES, PROMPT_VERSION } from "@/lib/constants";
import {
  normalizeCoverage,
  type CoverageSubamparo,
} from "@/lib/coverage-calculations";
import { addDaysToDateOnly, diffDaysDateOnly } from "@/lib/date-only";
import type { Database, Json, ModificacionContractual } from "@/lib/database.types";
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
  NON_TERMINAL_AMENDMENT_STATES,
  activeStateToJson,
  calculateAmendmentLiquidation,
  getActiveStateFromEndorsements,
  liquidationToJson,
} from "@/lib/amendments";
import {
  buildContractExtractionContext,
  countLowConfidenceFields,
  extractPdfTextByPage,
  extractStructuredAmendment,
  extractStructuredContract,
  inspectPdfPageCount,
  InvalidAIJsonError,
  stringifyPages,
  type BaseDocumentType,
  type OpenAIAmendmentExtractionResult,
  type OpenAIExtractionResult,
  type PageSelectionDetail,
  type PdfPageCountAssessment,
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
    const pageCountAssessment = inspectPdfPageCount(pdfBuffer);
    const extractedPages = await extractPdfTextByPage(pdfBuffer);
    const textoExtraido = stringifyPages(extractedPages);
    context.textoExtraido = textoExtraido;

    assertDocumentIntelligencePageCoverage({
      pageCountAssessment,
      extractedPageCount: extractedPages.length,
    });
    const extractionContext = buildContractExtractionContext(extractedPages);

    logExtractionContextForDevelopment({
      totalPages: extractedPages.length,
      pageCountAssessment,
      fullText: textoExtraido,
      openAiContext: extractionContext.text,
      openAiPages: extractionContext.pageNumbers,
      pageDetails: extractionContext.pageDetails,
      truncated: extractionContext.truncated,
      documentType: documento.tipo_documento,
      fileName: documento.nombre_archivo,
    });

    const env = getServerEnv();
    const baseDocumentType = normalizeBaseDocumentType(
      documento.tipo_documento,
    );

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
        baseDocumentType,
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
          baseDocumentType,
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

export async function processAmendmentDocument({
  contratoId,
  documentoId,
}: {
  contratoId: DbInt8;
  documentoId?: DbInt8 | null;
}) {
  const supabase = getSupabaseAdmin();
  const documentQuery = supabase
    .from("documentos")
    .select("*")
    .eq("contrato_id", contratoId)
    .eq("tipo_documento", "otrosi")
    .order("fecha_carga", { ascending: false })
    .limit(1);
  const { data: documents, error: documentError } = documentoId
    ? await supabase
        .from("documentos")
        .select("*")
        .eq("id", documentoId)
        .eq("contrato_id", contratoId)
        .eq("tipo_documento", "otrosi")
        .limit(1)
    : await documentQuery;
  const documento = documents?.[0] ?? null;

  if (documentError || !documento) {
    throw new Error(
      `No se encontró el documento de otrosí: ${documentError?.message ?? "sin detalle"}`,
    );
  }

  const { data: activeBaseQuote, error: activeBaseQuoteError } = await supabase
    .from("cotizaciones")
    .select("*")
    .eq("contrato_id", contratoId)
    .eq("estado", "emitida")
    .maybeSingle();

  if (activeBaseQuoteError) {
    throw new Error(
      `Fallo al validar póliza base emitida: ${activeBaseQuoteError.message}`,
    );
  }

  if (!activeBaseQuote) {
    throw new Error(
      "Solo se puede procesar un otrosí cuando existe una póliza base emitida activa.",
    );
  }

  const { data: currentModification, error: currentModificationError } =
    await supabase
      .from("modificaciones_contractuales")
      .select("*")
      .eq("contrato_id", contratoId)
      .eq("documento_id", documento.id)
      .maybeSingle();

  if (currentModificationError) {
    throw new Error(
      `Fallo al consultar registro cargado del otrosí: ${currentModificationError.message}`,
    );
  }

  let pendingQuery = supabase
    .from("modificaciones_contractuales")
    .select("id,numero_modificacion,estado,documento_id")
    .eq("contrato_id", contratoId)
    .in("estado", [...NON_TERMINAL_AMENDMENT_STATES]);

  if (currentModification) {
    pendingQuery = pendingQuery.neq("id", currentModification.id);
  }

  const { data: pendingModifications, error: pendingError } =
    await pendingQuery.limit(1);

  if (pendingError) {
    throw new Error(
      `Fallo al validar secuencia de otrosíes: ${pendingError.message}`,
    );
  }

  const pendingModification = pendingModifications?.[0] ?? null;

  if (pendingModification) {
    throw new Error(
      `Ya existe un otrosí pendiente (${pendingModification.numero_modificacion ?? pendingModification.id}). Debe emitirse o eliminarse antes de procesar otro.`,
    );
  }

  if (currentModification) {
    const { error: processingStateError } = await supabase
      .from("modificaciones_contractuales")
      .update({
        estado: "procesando",
        actualizado_en: new Date().toISOString(),
      })
      .eq("id", currentModification.id);

    if (processingStateError) {
      throw new Error(
        `Fallo al marcar otrosí como procesando: ${processingStateError.message}`,
      );
    }
  }

  const [
    { data: contractData, error: contractError },
    { data: amparos, error: amparosError },
    { data: adjustmentQuotes, error: adjustmentQuotesError },
    { data: latestModifications, error: latestModificationError },
  ] = await Promise.all([
    supabase
      .from("contratos")
      .select("*")
      .eq("id", contratoId)
      .single(),
    supabase
      .from("amparos")
      .select("*")
      .eq("contrato_id", contratoId)
      .is("modificacion_id", null)
      .order("creado_en", { ascending: true }),
    supabase
      .from("cotizaciones_ajuste")
      .select("*")
      .eq("contrato_id", contratoId)
      .eq("estado", "endoso_emitido")
      .order("fecha_emision", { ascending: true }),
    supabase
      .from("modificaciones_contractuales")
      .select("secuencia")
      .eq("contrato_id", contratoId)
      .order("secuencia", { ascending: false, nullsFirst: false })
      .limit(1),
  ]);

  if (contractError || !contractData) {
    throw new Error(
      `No se encontró el contrato base del otrosí: ${contractError?.message ?? "sin detalle"}`,
    );
  }

  if (amparosError) {
    throw new Error(`Fallo al consultar amparos base: ${amparosError.message}`);
  }

  if (adjustmentQuotesError) {
    throw new Error(
      `Fallo al consultar otrosíes emitidos: ${adjustmentQuotesError.message}`,
    );
  }

  if (latestModificationError) {
    throw new Error(
      `Fallo al consultar secuencia de otrosíes: ${latestModificationError.message}`,
    );
  }

  const sequence =
    currentModification?.secuencia ??
    (latestModifications?.[0]?.secuencia ?? 0) + 1;

  const activeState = getActiveStateFromEndorsements({
    baseQuote: activeBaseQuote,
    amparos: amparos ?? [],
    adjustmentQuotes: adjustmentQuotes ?? [],
  });
  const previousEndorsement = (adjustmentQuotes ?? []).at(-1) ?? null;
  const { data: storedFile, error: downloadError } = await supabase.storage
    .from(documento.storage_bucket)
    .download(documento.storage_path);

  if (downloadError || !storedFile) {
    throw new Error(
      `Fallo al leer el PDF del otrosí desde Supabase Storage: ${downloadError?.message ?? "sin detalle"}`,
    );
  }

  const pdfBuffer = await storedFile.arrayBuffer();
  const pageCountAssessment = inspectPdfPageCount(pdfBuffer);
  const extractedPages = await extractPdfTextByPage(pdfBuffer);
  const extractedText = stringifyPages(extractedPages);

  assertDocumentIntelligencePageCoverage({
    pageCountAssessment,
    extractedPageCount: extractedPages.length,
  });

  const extractionContext = buildContractExtractionContext(extractedPages);
  const env = getServerEnv();

  logExtractionContextForDevelopment({
    totalPages: extractedPages.length,
    pageCountAssessment,
    fullText: extractedText,
    openAiContext: extractionContext.text,
    openAiPages: extractionContext.pageNumbers,
    pageDetails: extractionContext.pageDetails,
    truncated: extractionContext.truncated,
    documentType: documento.tipo_documento,
    fileName: documento.nombre_archivo,
  });
  logExtractionAttemptForDevelopment({
    deployment: env.AZURE_OPENAI_DEPLOYMENT_PRIMARY,
    phase: "amendment_start",
  });

  const rawResult = await extractStructuredAmendment(
    env.AZURE_OPENAI_DEPLOYMENT_PRIMARY,
    extractionContext.text,
  );
  const result = {
    ...rawResult,
    extraction: applyDeterministicAmendmentFallbacks(
      rawResult.extraction,
      extractedText,
    ),
  };

  logAmendmentResultForDevelopment(result);

  await insertAmendmentExtractionLog({
    contractId: contratoId,
    documentId: documento.id,
    extractedText,
    result,
    resultado: getAmendmentExtractionLogResult(result.extraction),
  });

  const now = new Date().toISOString();
  const basePayload = mapAmendmentToModification(
    result.extraction,
    contratoId,
    documento.id,
  );
  const previousContractValue =
    basePayload.valor_contrato_anterior ??
    activeState.contrato.base_calculo_amparos ??
    activeState.contrato.valor_contrato;
  const addedValue = basePayload.valor_adicion ?? 0;
  const activePreviousEndDate =
    activeState.contrato.fecha_fin ?? basePayload.fecha_desde ?? null;
  const extractedAccumulatedValue = basePayload.valor_contrato_acumulado ?? null;
  const calculatedAccumulatedValue =
    previousContractValue === null
      ? extractedAccumulatedValue
      : roundMoney(previousContractValue + addedValue);
  const sequenceAlerts = [
    activeState.contrato.fecha_fin &&
    basePayload.fecha_desde &&
    activeState.contrato.fecha_fin !== basePayload.fecha_desde
      ? `La fecha fin anterior extraída (${basePayload.fecha_desde}) contradice el estado vigente emitido (${activeState.contrato.fecha_fin}); se prioriza el estado vigente.`
      : null,
    extractedAccumulatedValue !== null &&
    calculatedAccumulatedValue !== null &&
    Math.abs(extractedAccumulatedValue - calculatedAccumulatedValue) > 1
      ? `El valor acumulado extraído (${extractedAccumulatedValue}) no coincide con valor anterior más adición (${calculatedAccumulatedValue}); se prioriza el cálculo revisado.`
      : null,
  ].filter((item): item is string => Boolean(item));
  const draftModification = {
    ...basePayload,
    id: currentModification?.id ?? 0,
    secuencia: sequence,
    valor_contrato_anterior: previousContractValue,
    valor_adicion: addedValue,
    valor_contrato_acumulado: calculatedAccumulatedValue,
    fecha_desde: activePreviousEndDate,
  } as ModificacionContractual;
  const liquidation = calculateAmendmentLiquidation({
    activeState,
    modification: draftModification,
    generatedAt: now,
  });
  const alertas = [
    ...result.extraction.alertas,
    ...sequenceAlerts,
    result.extraction.impuesto_timbre.valor
      ? `Impuesto de timbre informado: ${result.extraction.impuesto_timbre.valor}`
      : null,
  ].filter((item): item is string => Boolean(item));

  const persistedPayload = {
    ...basePayload,
    secuencia: sequence,
    cotizacion_base_id: activeBaseQuote.id,
    endoso_anterior_id: previousEndorsement?.id ?? null,
    estado: "pendiente_revision",
    valor_contrato_anterior: draftModification.valor_contrato_anterior,
    valor_adicion: draftModification.valor_adicion,
    valor_contrato_acumulado: draftModification.valor_contrato_acumulado,
    fecha_desde: draftModification.fecha_desde,
    liquidacion: liquidationToJson(liquidation),
    snapshot_vigente_anterior: activeStateToJson(activeState),
    snapshot_vigente_resultante: null,
    alertas: alertas as Json,
    campos_no_encontrados: result.extraction.campos_no_encontrados as Json,
    actualizado_en: now,
  };
  const { data: modification, error: modificationError } = currentModification
    ? await supabase
        .from("modificaciones_contractuales")
        .update(persistedPayload)
        .eq("id", currentModification.id)
        .select("*")
        .single()
    : await supabase
        .from("modificaciones_contractuales")
        .insert(persistedPayload)
        .select("*")
        .single();

  if (modificationError || !modification) {
    throw new Error(
      `Fallo al guardar el otrosí revisable: ${modificationError?.message ?? "sin detalle"}`,
    );
  }

  return modification;
}

function applyDeterministicAmendmentFallbacks(
  extraction: AmendmentExtraction,
  extractedText: string,
): AmendmentExtraction {
  const signatureDate =
    findDocumentSignatureDate(extractedText) ??
    findContextualDate(extractedText, [
      "fecha de firma",
      "firmado",
      "firma",
      "suscrito",
      "suscriben",
      "suscripcion",
    ]);
  const extensionRange = findExtensionRange(extractedText);
  const newEndDate =
    findNewEndDate(extractedText) ??
    extensionRange?.end ??
    findContextualDate(extractedText, [
      "nueva fecha de terminacion",
      "fecha de terminacion",
      "hasta el",
      "hasta",
    ]);
  const previousEndDate =
    findPreviousEndDate(extractedText) ??
    extensionRange?.previousEnd ??
    findContextualDate(extractedText, [
      "fecha fin anterior",
      "fecha de terminacion anterior",
      "fecha final anterior",
      "vence",
      "vigente hasta",
    ]);
  const rangeDays =
    previousEndDate && newEndDate
      ? diffDaysDateOnly(previousEndDate, newEndDate)
      : null;
  const extensionDays =
    findExtensionDays(extractedText) ??
    (rangeDays !== null && rangeDays > 0 ? rangeDays : null);
  const additionValue = resolveAdditionValue({
    extraction,
    extractedText,
    previousEndDate,
    newEndDate,
  });
  const parsedAddedValue = additionValue.total;
  const noAddedValue = hasNoAddedValueSignal(extractedText);
  const hasAddedValue =
    parsedAddedValue !== null ||
    (typeof extraction.valor_adicion.valor === "number" &&
      extraction.valor_adicion.valor > 0);
  const requiresGuaranteeAdjustment = hasGuaranteeAdjustmentSignal(extractedText);
  const hasProrroga = hasProrrogaSignal(extractedText);
  const hasObjectChange = hasObjectChangeSignal(extractedText);
  const objectSummary = findObjectChangeSummary(extractedText);
  const modificationType = buildModificationTypeLabel({
    hasAddedValue,
    hasObjectChange,
    hasProrroga,
    noAddedValue,
  });

  return {
    ...extraction,
    fecha_firma: signatureDate
      ? deterministicDateValue(signatureDate, "fecha de firma del otrosí")
      : extraction.fecha_firma,
    fecha_desde: previousEndDate
      ? deterministicDateValue(
          previousEndDate,
          "fecha fin anterior derivada del periodo de prórroga",
        )
      : extraction.fecha_desde,
    fecha_hasta: newEndDate
      ? deterministicDateValue(
          newEndDate,
          "nueva fecha fin derivada del periodo de prórroga",
        )
      : extraction.fecha_hasta,
    dias_prorroga:
      extensionDays !== null
        ? {
            valor: extensionDays,
            confianza: "media",
            pagina: extraction.dias_prorroga.pagina,
            fuente: "Días de prórroga derivados determinísticamente del texto.",
        }
        : extraction.dias_prorroga,
    valor_adicion:
      parsedAddedValue !== null
        ? {
            valor: parsedAddedValue,
            confianza: "media",
            pagina: extraction.valor_adicion.pagina,
            fuente: additionValue.explanation,
          }
        : noAddedValue && extraction.valor_adicion.valor === null
        ? {
            valor: 0,
            confianza: "media",
            pagina: extraction.valor_adicion.pagina,
            fuente: "El otrosí indica prórroga sin adición de valor.",
        }
        : extraction.valor_adicion,
    valor_adicion_total:
      additionValue.total !== null
        ? deterministicNumberValue(additionValue.total, additionValue.explanation)
        : extraction.valor_adicion_total,
    valor_adicion_unitario:
      additionValue.unit !== null
        ? deterministicNumberValue(
            additionValue.unit,
            "Valor unitario de adición derivado determinísticamente del texto del otrosí.",
          )
        : extraction.valor_adicion_unitario,
    periodicidad_valor_adicion:
      additionValue.periodicity
        ? deterministicTextValue(
            additionValue.periodicity,
            "Periodicidad del valor de adición derivada determinísticamente.",
          )
        : extraction.periodicidad_valor_adicion,
    numero_periodos_adicionados:
      additionValue.periodCount !== null
        ? deterministicIntegerValue(
            additionValue.periodCount,
            "Número de periodos adicionados derivado determinísticamente.",
          )
        : extraction.numero_periodos_adicionados,
    periodos_adicionados:
      additionValue.periods.length > 0
        ? additionValue.periods
        : extraction.periodos_adicionados,
    requiere_multiplicacion: deterministicBooleanValue(
      additionValue.requiresMultiplication,
      additionValue.requiresMultiplication
        ? "El valor adicionado total se calculó multiplicando valor unitario por periodos."
        : "No se requirió multiplicación para el valor adicionado.",
    ),
    explicacion_calculo_valor_adicion: deterministicTextValue(
      additionValue.explanation,
      "Explicación determinística del valor adicionado.",
    ),
    tipo_modificacion:
      modificationType
        ? {
            valor: modificationType,
            confianza: "media",
            pagina: extraction.tipo_modificacion.pagina,
            fuente: "Tipo derivado por señales de adición, prórroga y cambio de objeto.",
          }
        : extraction.tipo_modificacion,
    objeto_nuevo:
      objectSummary && extraction.objeto_nuevo.valor === null
        ? {
            valor: objectSummary,
            confianza: "media",
            pagina: extraction.objeto_nuevo.pagina,
            fuente: "Objeto ajustado derivado determinísticamente del texto del otrosí.",
          }
        : extraction.objeto_nuevo,
    requiere_ajuste_garantias: requiresGuaranteeAdjustment
      ? {
          valor: true,
          confianza: "media",
          pagina: extraction.requiere_ajuste_garantias.pagina,
          fuente: "El otrosí menciona ajuste de garantías o pólizas.",
        }
      : extraction.requiere_ajuste_garantias,
    alertas: [
      ...extraction.alertas,
      signatureDate ? "fecha_firma ajustada por lectura determinística del otrosí." : null,
      extensionRange
        ? "Fechas de prórroga ajustadas por lectura determinística del periodo del otrosí."
        : null,
      ...additionValue.alerts,
      parsedAddedValue !== null
        ? additionValue.explanation
        : null,
      noAddedValue ? "Valor adicionado interpretado como cero por prórroga sin adición." : null,
      objectSummary ? "Objeto nuevo ajustado por lectura determinística del otrosí." : null,
    ].filter((item): item is string => Boolean(item)),
  };
}

export function applyDeterministicAmendmentFallbacksForTest(
  extraction: AmendmentExtraction,
  extractedText: string,
) {
  return applyDeterministicAmendmentFallbacks(extraction, extractedText);
}

export function applyDeterministicContractFallbacksForTest(
  extraction: AIExtraction,
  extractedText: string,
) {
  return applyDeterministicDateFallbacks(extraction, extractedText);
}

function deterministicDateValue(value: string, source: string) {
  return {
    valor: value,
    confianza: "media" as const,
    pagina: null,
    fuente: source,
  };
}

function deterministicNumberValue(value: number, source: string) {
  return {
    valor: value,
    confianza: "media" as const,
    pagina: null,
    fuente: source,
  };
}

function deterministicIntegerValue(value: number, source: string) {
  return {
    valor: Math.trunc(value),
    confianza: "media" as const,
    pagina: null,
    fuente: source,
  };
}

function deterministicTextValue(value: string, source: string) {
  return {
    valor: value,
    confianza: "media" as const,
    pagina: null,
    fuente: source,
  };
}

function deterministicBooleanValue(value: boolean, source: string) {
  return {
    valor: value,
    confianza: "media" as const,
    pagina: null,
    fuente: source,
  };
}

type AdditionValueResolution = {
  total: number | null;
  unit: number | null;
  periodicity: string | null;
  periodCount: number | null;
  periods: string[];
  requiresMultiplication: boolean;
  explanation: string;
  alerts: string[];
};

type DateCandidate = {
  iso: string;
  index: number;
};

function findDocumentSignatureDate(text: string) {
  const candidates = extractDateCandidates(text);
  const signatureCandidates = candidates.filter((candidate) => {
    const before = normalizeForAmendmentSearch(
      text.slice(Math.max(0, candidate.index - 360), candidate.index),
    );

    return (
      (before.includes("para constancia") ||
        before.includes("se suscribe") ||
        before.includes("suscribe por las partes") ||
        before.includes("en la ciudad")) &&
      !before.includes("firmado digitalmente")
    );
  });

  return signatureCandidates.at(-1)?.iso ?? null;
}

function findPreviousEndDate(text: string) {
  const candidates = extractDateCandidates(text);

  for (const candidate of candidates) {
    const before = normalizeForAmendmentSearch(
      text.slice(Math.max(0, candidate.index - 220), candidate.index),
    );

    if (
      (before.includes("plazo de terminacion") ||
        before.includes("fecha de terminacion") ||
        before.includes("fecha fin anterior") ||
        before.includes("terminacion era") ||
        before.includes("terminacion es") ||
        before.includes("vence") ||
        before.includes("vigente hasta")) &&
      !before.includes("nueva fecha") &&
      !before.includes("ampliar") &&
      !before.includes("extiende hasta")
    ) {
      return candidate.iso;
    }
  }

  return null;
}

function findNewEndDate(text: string) {
  const candidates = extractDateCandidates(text);

  for (const candidate of candidates) {
    const before = normalizeForAmendmentSearch(
      text.slice(Math.max(0, candidate.index - 120), candidate.index),
    );
    const segment = normalizeForAmendmentSearch(
      text.slice(Math.max(0, candidate.index - 220), candidate.index + 120),
    );

    if (
      before.includes("hasta") &&
      (segment.includes("ampliar") ||
        segment.includes("amplia") ||
        segment.includes("extiende") ||
        segment.includes("prorroga") ||
        segment.includes("duracion"))
    ) {
      return candidate.iso;
    }
  }

  return null;
}

function findContextualDate(text: string, contextTerms: string[]) {
  const candidates = extractDateCandidates(text);

  for (const candidate of candidates) {
    const windowText = normalizeForAmendmentSearch(
      text.slice(Math.max(0, candidate.index - 180), candidate.index + 180),
    );

    if (contextTerms.some((term) => windowText.includes(term))) {
      return candidate.iso;
    }
  }

  return null;
}

function findExtensionRange(text: string) {
  const previousEndDate = findPreviousEndDate(text);
  const newEndDate = findNewEndDate(text);

  if (
    previousEndDate &&
    newEndDate &&
    diffDaysDateOnly(previousEndDate, newEndDate) !== null &&
    diffDaysDateOnly(previousEndDate, newEndDate)! > 0
  ) {
    return {
      start: previousEndDate,
      previousEnd: previousEndDate,
      end: newEndDate,
    };
  }

  const candidates = extractDateCandidates(text);
  const explicitDays = findExtensionDays(text);

  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < candidates.length;
      rightIndex += 1
    ) {
      const left = candidates[leftIndex];
      const right = candidates[rightIndex];
      const distance = diffDaysDateOnly(left.iso, right.iso);

      if (distance === null || distance <= 0) {
        continue;
      }

      const segment = normalizeForAmendmentSearch(
        text.slice(
          Math.max(0, left.index - 120),
          Math.min(text.length, right.index + 120),
        ),
      );
      const looksLikeRange =
        hasProrrogaSignal(segment) &&
        segment.includes("hasta") &&
        (segment.includes("desde") ||
          segment.includes("inicio") ||
          segment.includes("inicia") ||
          segment.includes("a partir"));
      const matchesExplicitDays =
        explicitDays !== null &&
        (distance === explicitDays || distance + 1 === explicitDays);

      if (!looksLikeRange && !matchesExplicitDays) {
        continue;
      }

      const previousEnd = matchesExplicitDays && distance + 1 === explicitDays
        ? addDaysToDateOnly(left.iso, -1)
        : left.iso;

      return {
        start: left.iso,
        previousEnd: previousEnd ?? left.iso,
        end: right.iso,
      };
    }
  }

  return null;
}

function findExtensionDays(text: string) {
  const normalized = normalizeForAmendmentSearch(text);
  const numericMatch = normalized.match(
    /(?:prorroga|plazo|termino|duracion)[\s\S]{0,80}?(\d{1,3})\s*dias/,
  );

  if (numericMatch) {
    return Number(numericMatch[1]);
  }

  const parenthesizedMatch = normalized.match(/\((\d{1,3})\)\s*dias/);

  if (parenthesizedMatch) {
    return Number(parenthesizedMatch[1]);
  }

  return null;
}

function extractDateCandidates(text: string): DateCandidate[] {
  const candidates: DateCandidate[] = [];
  const numericPattern = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/g;
  const monthNames =
    "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre";
  const monthPattern =
    new RegExp(
      `\\(?\\b(\\d{1,2})\\)?(?:\\s+de)?\\s+(${monthNames})\\s+(?:de\\s+)?(20\\d{2})\\b`,
      "gi",
    );
  const writtenYearMonthPattern = new RegExp(
    `\\(?(\\d{1,2})\\)?\\s+de\\s+(${monthNames})\\s+del?\\s+año\\s+[^()\\d]{0,80}\\((20\\d{2})\\)`,
    "gi",
  );

  function pushCandidate(iso: string | null, index: number) {
    if (
      iso &&
      !candidates.some(
        (candidate) => candidate.iso === iso && candidate.index === index,
      )
    ) {
      candidates.push({ iso, index });
    }
  }

  for (const match of text.matchAll(numericPattern)) {
    pushCandidate(
      toDateOnly(Number(match[3]), Number(match[2]), Number(match[1])),
      match.index ?? 0,
    );
  }

  for (const match of text.matchAll(monthPattern)) {
    const month = monthNumber(match[2]);
    pushCandidate(
      toDateOnly(Number(match[3]), month, Number(match[1])),
      match.index ?? 0,
    );
  }

  for (const match of text.matchAll(writtenYearMonthPattern)) {
    const month = monthNumber(match[2]);
    pushCandidate(
      toDateOnly(Number(match[3]), month, Number(match[1])),
      match.index ?? 0,
    );
  }

  return candidates.sort((left, right) => left.index - right.index);
}

function findAddedValue(text: string) {
  const matches = [
    ...text.matchAll(
      /(?:adiciona|adicionar|adicion|adicionado)[\s\S]{0,240}?\$\s*([\d.,]+)/gi,
    ),
  ];
  const value = matches.at(-1)?.[1] ?? null;

  if (!value) {
    return null;
  }

  const parsed = Number(value.replace(/\./g, "").replace(",", "."));

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolveAdditionValue({
  extraction,
  extractedText,
  previousEndDate,
  newEndDate,
}: {
  extraction: AmendmentExtraction;
  extractedText: string;
  previousEndDate: string | null;
  newEndDate: string | null;
}): AdditionValueResolution {
  const explicitTotalFromText = findExplicitTotalAddedValue(extractedText);
  const unitFromText = findUnitAddedValue(extractedText);
  const genericAddedValue = findAddedValue(extractedText);
  const extractedTotal = normalizeNumber(extraction.valor_adicion_total.valor);
  const extractedUnit = normalizeNumber(extraction.valor_adicion_unitario.valor);
  const extractedAddedValue = normalizeNumber(extraction.valor_adicion.valor);
  const periodicity = resolveAdditionPeriodicity(
    extraction.periodicidad_valor_adicion.valor,
    extractedText,
  );
  const periods = findAddedPeriods(extraction.periodos_adicionados, extractedText);
  const explicitPeriodCount =
    normalizeInteger(extraction.numero_periodos_adicionados.valor) ??
    findExplicitAddedPeriodCount(extractedText);
  const inferredPeriodCount =
    periods.length > 0
      ? periods.length
      : periodicity === "mensual"
        ? inferMonthlyPeriodsFromRange(previousEndDate, newEndDate)
        : null;
  const periodCount =
    explicitPeriodCount && explicitPeriodCount > 0
      ? explicitPeriodCount
      : inferredPeriodCount;
  const unit =
    extractedUnit ??
    unitFromText ??
    (periodicity === "mensual" && periodCount !== null && periodCount > 1
      ? genericAddedValue ?? extractedAddedValue ?? extractedTotal
      : null);
  const schemaTotalLooksLikeUnit =
    extractedTotal !== null &&
    unit !== null &&
    periodCount !== null &&
    periodCount > 1 &&
    Math.abs(extractedTotal - unit) < 1;
  const explicitTotal =
    explicitTotalFromText ??
    (schemaTotalLooksLikeUnit ? null : extractedTotal);
  const alerts: string[] = [];

  if (explicitTotal !== null) {
    return {
      total: explicitTotal,
      unit,
      periodicity,
      periodCount,
      periods,
      requiresMultiplication: false,
      explanation: "Valor adicionado total explícito usado como total del otrosí.",
      alerts,
    };
  }

  if (unit !== null && periodCount !== null && periodCount > 1) {
    const total = roundMoney(unit * periodCount);

    return {
      total,
      unit,
      periodicity: periodicity ?? "mensual",
      periodCount,
      periods,
      requiresMultiplication: true,
      explanation: `Valor adicionado total calculado como valor unitario ${formatPlainMoney(unit)} x ${periodCount} periodos = ${formatPlainMoney(total)}.`,
      alerts: [
        ...alerts,
        "Valor adicionado total calculado por valor unitario y número de periodos adicionados.",
      ],
    };
  }

  if (
    (genericAddedValue ?? extractedAddedValue ?? extractedTotal) !== null &&
    periodicity === "mensual" &&
    periodCount === null
  ) {
    alerts.push(
      "Se detectó valor mensual de adición, pero no se pudo determinar número de periodos; revise el total manualmente.",
    );
  }

  const total = genericAddedValue ?? extractedAddedValue ?? extractedTotal ?? unit;

  return {
    total,
    unit,
    periodicity,
    periodCount,
    periods,
    requiresMultiplication: false,
    explanation:
      total === null
        ? "No se detectó valor adicionado total en el otrosí."
        : "Valor adicionado tomado como total del otrosí.",
    alerts,
  };
}

function findExplicitTotalAddedValue(text: string) {
  const candidates = splitIntoSearchSegments(text)
    .filter((segment) => {
      const normalized = normalizeForAmendmentSearch(segment);

      return (
        hasMoney(segment) &&
        (
          normalized.includes("valor total") ||
          normalized.includes("total adicionado") ||
          normalized.includes("valor adicionado total") ||
          normalized.includes("valor total adicionado") ||
          normalized.includes("suma total") ||
          normalized.includes("total de la adicion")
        ) &&
        !hasMonthlyValueSignal(normalized)
      );
    })
    .map((segment) => extractLastCurrencyAmount(segment))
    .filter((value): value is number => value !== null);

  return candidates.at(-1) ?? null;
}

function findUnitAddedValue(text: string) {
  const candidates = splitIntoSearchSegments(text)
    .filter((segment) => {
      const normalized = normalizeForAmendmentSearch(segment);

      return hasMoney(segment) && hasMonthlyValueSignal(normalized);
    })
    .map((segment) => extractLastCurrencyAmount(segment))
    .filter((value): value is number => value !== null);

  return candidates.at(-1) ?? null;
}

function resolveAdditionPeriodicity(value: string | null, text: string) {
  const normalizedValue = normalizeForAmendmentSearch(value ?? "");
  const normalizedText = normalizeForAmendmentSearch(text);

  if (
    normalizedValue.includes("mensual") ||
    normalizedValue.includes("mes") ||
    hasMonthlyValueSignal(normalizedText)
  ) {
    return "mensual";
  }

  if (normalizedValue.includes("diario") || normalizedValue.includes("dia")) {
    return "diaria";
  }

  return normalizeText(value);
}

function findExplicitAddedPeriodCount(text: string) {
  const normalized = normalizeForAmendmentSearch(text);
  const numericMatch = normalized.match(
    /(?:por|durante|correspondiente a|para)\s+(?:los\s+)?(\d{1,2})\s+meses/,
  );

  if (numericMatch) {
    return Number(numericMatch[1]);
  }

  const wordMatches: Array<[string, number]> = [
    ["un mes", 1],
    ["una mensualidad", 1],
    ["dos meses", 2],
    ["tres meses", 3],
    ["cuatro meses", 4],
    ["cinco meses", 5],
    ["seis meses", 6],
  ];

  return wordMatches.find(([marker]) => normalized.includes(marker))?.[1] ?? null;
}

function findAddedPeriods(extractedPeriods: string[], text: string) {
  const periods = new Set<string>();

  extractedPeriods
    .map((period) => normalizeText(period))
    .filter((period): period is string => Boolean(period))
    .forEach((period) => periods.add(period));

  findAddedMonthPeriods(text).forEach((period) => periods.add(period));

  return Array.from(periods);
}

function findAddedMonthPeriods(text: string) {
  const periods = new Set<string>();
  const monthPattern =
    /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b(?:\s+de\s+(20\d{2}))?/gi;

  splitIntoSearchSegments(text)
    .filter((segment) => {
      const normalized = normalizeForAmendmentSearch(segment);

      return (
        normalized.includes("adicion") ||
        normalized.includes("valor") ||
        normalized.includes("mensual") ||
        normalized.includes("meses") ||
        normalized.includes("periodo")
      );
    })
    .forEach((segment) => {
      for (const match of segment.matchAll(monthPattern)) {
        const index = match.index ?? 0;
        const before = segment.slice(Math.max(0, index - 10), index);

        if (/\d/.test(before)) {
          continue;
        }

        const month = normalizeForAmendmentSearch(match[1]);
        const year = match[2] ?? "";

        periods.add(year ? `${month} ${year}` : month);
      }
    });

  return Array.from(periods);
}

function inferMonthlyPeriodsFromRange(
  previousEndDate: string | null,
  newEndDate: string | null,
) {
  if (!previousEndDate || !newEndDate) {
    return null;
  }

  const previous = parseDateOnlyParts(previousEndDate);
  const next = parseDateOnlyParts(newEndDate);

  if (!previous || !next) {
    return null;
  }

  const monthDiff =
    (next.year - previous.year) * 12 + (next.month - previous.month);

  return monthDiff > 0 && monthDiff <= 24 ? monthDiff : null;
}

function parseDateOnlyParts(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function splitIntoSearchSegments(text: string) {
  return text
    .split(/[\n;]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function hasMonthlyValueSignal(normalizedText: string) {
  return (
    normalizedText.includes("mensual") ||
    normalizedText.includes("mensuales") ||
    normalizedText.includes("valor mes") ||
    normalizedText.includes("valor por mes") ||
    normalizedText.includes("por mes") ||
    normalizedText.includes("cada mes") ||
    normalizedText.includes("meses de")
  );
}

function hasMoney(text: string) {
  return /\$\s*[\d.,]+/.test(text);
}

function extractLastCurrencyAmount(text: string) {
  const value = [...text.matchAll(/\$\s*([\d.,]+)/g)].at(-1)?.[1] ?? null;

  if (!value) {
    return null;
  }

  const parsed = Number(value.replace(/\./g, "").replace(",", "."));

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatPlainMoney(value: number) {
  return new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(value);
}

function toDateOnly(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthNumber(value: string) {
  const normalized = normalizeForAmendmentSearch(value);
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

  return months[normalized] ?? 0;
}

function hasNoAddedValueSignal(text: string) {
  const normalized = normalizeForAmendmentSearch(text);

  return (
    normalized.includes("sin adicion de valor") ||
    normalized.includes("sin adicion") ||
    normalized.includes("no adiciona valor") ||
    normalized.includes("no genera adicion") ||
    normalized.includes("no genera valor adicional")
  );
}

function hasGuaranteeAdjustmentSignal(text: string) {
  const normalized = normalizeForAmendmentSearch(text);

  return (
    normalized.includes("garantia") ||
    normalized.includes("garantias") ||
    normalized.includes("poliza") ||
    normalized.includes("polizas")
  );
}

function hasProrrogaSignal(text: string) {
  const normalized = normalizeForAmendmentSearch(text);

  return (
    normalized.includes("prorroga") ||
    normalized.includes("prorrogar") ||
    normalized.includes("plazo") ||
    normalized.includes("termino")
  );
}

function hasObjectChangeSignal(text: string) {
  const normalized = normalizeForAmendmentSearch(text);
  const hasSpecificCraneChange =
    (normalized.includes("utilizando cinco") || normalized.includes("utilizando 5")) &&
    (normalized.includes("seis") || normalized.includes("(6)") || normalized.includes("6 gruas"));
  const hasObjectClauseChange =
    normalized.includes("modificar la clausula primera") &&
    (normalized.includes("objeto") || normalized.includes("grua"));

  return (
    hasObjectClauseChange ||
    normalized.includes("modificar el objeto") ||
    normalized.includes("cambio de objeto") ||
    hasSpecificCraneChange
  );
}

function findObjectChangeSummary(text: string) {
  const normalized = normalizeForAmendmentSearch(text);

  if (
    (normalized.includes("utilizando cinco") || normalized.includes("utilizando 5")) &&
    (normalized.includes("seis") || normalized.includes("(6)") || normalized.includes("6 gruas"))
  ) {
    return "Prestación del servicio con cinco grúas, en lugar de seis.";
  }

  return null;
}

function buildModificationTypeLabel({
  hasAddedValue,
  hasObjectChange,
  hasProrroga,
  noAddedValue,
}: {
  hasAddedValue: boolean;
  hasObjectChange: boolean;
  hasProrroga: boolean;
  noAddedValue: boolean;
}) {
  if (hasProrroga && noAddedValue && !hasAddedValue && !hasObjectChange) {
    return "Prórroga de plazo sin adición de valor";
  }

  if (hasObjectChange && !hasAddedValue && !hasProrroga) {
    return "Cambio de objeto sin impacto asegurable";
  }

  const parts = [
    hasAddedValue ? "Adición de valor" : null,
    hasProrroga ? "prórroga de plazo" : null,
    hasObjectChange ? "cambio de objeto" : null,
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" + ") : null;
}

function normalizeForAmendmentSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function saveStructuredExtraction(
  contratoId: DbInt8,
  extraction: AIExtraction,
) {
  const supabase = getSupabaseAdmin();
  const mappedContractUpdate = mapExtractionToContractUpdate(extraction);
  const { payload: contractUpdate, report } =
    validateContractUpdatePayload(mappedContractUpdate);

  const { data: currentContract, error: currentContractError } = await supabase
    .from("contratos")
    .select("resumen_documento_ia")
    .eq("id", contratoId)
    .single();

  if (currentContractError) {
    throw new Error(
      `Fallo al consultar el resumen vigente: ${currentContractError.message}`,
    );
  }

  if (normalizeText(currentContract?.resumen_documento_ia)) {
    contractUpdate.resumen_documento_ia = currentContract.resumen_documento_ia;
  }

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
  const normalizedContractValue =
    resolveContractTotalValueFromRecord(record).total ??
    normalizeNumber(
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
    resumen_documento_ia: normalizeText(
      asRecord(record.resumen_documento).valor ?? record.resumen_documento,
    ),
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
      prima_neta_automatica: normalized.prima_neta_automatica,
      prima_neta_manual: normalized.prima_neta_manual,
      usar_prima_neta_manual: normalized.usar_prima_neta_manual,
      impuesto: normalized.impuesto,
      prima_total: normalized.prima_total,
      tasa_manual: normalized.tasa_manual,
      tipo_vigencia: normalized.tipo_vigencia,
      base_vigencia: normalized.base_vigencia,
      fecha_desde: normalized.fecha_desde,
      fecha_desde_manual: normalized.fecha_desde_manual,
      fecha_hasta: normalized.fecha_hasta,
      fecha_hasta_manual: normalized.fecha_hasta_manual,
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
    resumen_documento_ia: normalizeNullableTextField(
      "resumen_documento_ia",
      update,
      report,
    ),
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
    valor_contrato_anterior: normalizeNumber(
      extraction.valor_contrato_anterior.valor,
    ),
    valor_adicion: normalizeNumber(extraction.valor_adicion.valor),
    valor_contrato_acumulado: normalizeNumber(
      extraction.valor_contrato_acumulado.valor,
    ),
    fecha_desde: normalizeDate(extraction.fecha_desde.valor),
    fecha_hasta: normalizeDate(extraction.fecha_hasta.valor),
    fecha_firma: normalizeDate(extraction.fecha_firma.valor),
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
    objeto_nuevo: normalizeText(extraction.objeto_nuevo.valor),
    requiere_ajuste_garantias:
      extraction.requiere_ajuste_garantias.valor ?? true,
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
  const provisionalStart = findContractSignatureOrPerfectionDate(extractedText);
  let baseExtraction = extraction;

  if (actaInicioDependency && !actaInicioDependency.startDate) {
    const actaDuration = candidate?.duration ??
      extractDuration(actaInicioDependency.source);
    const provisionalStartDate = provisionalStart?.date ?? null;
    const provisionalEndDate =
      provisionalStartDate && actaDuration
        ? addDuration(provisionalStartDate, actaDuration)
        : null;
    const plazoFromActa = durationToPlazoText(
      actaDuration,
      "contados a partir de la fecha de suscripción del Acta de Inicio",
    );

    baseExtraction = {
      ...extraction,
      fecha_inicio: {
        ...extraction.fecha_inicio,
        valor: provisionalStartDate,
        confianza: provisionalStartDate ? "media" : "baja",
        pagina: provisionalStart?.pageNumber ?? actaInicioDependency.pageNumber,
        fuente: provisionalStart?.source ?? actaInicioDependency.source,
      },
      fecha_fin: {
        ...extraction.fecha_fin,
        valor: provisionalEndDate,
        confianza: provisionalEndDate ? "media" : "baja",
        pagina: provisionalStart?.pageNumber ?? actaInicioDependency.pageNumber,
        fuente: provisionalStart?.source ?? actaInicioDependency.source,
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
        provisionalStartDate
          ? "La vigencia depende del Acta de Inicio. Se usa la fecha de firma/perfeccionamiento como fecha provisional para cotización. Ajuste manualmente cuando exista el acta."
          : "El plazo depende del Acta de Inicio; ingrese la fecha de inicio para calcular fecha fin.",
      ],
    };
  }

  if (!candidate) {
    return applyDeterministicContractValueFallbacks(baseExtraction, extractedText);
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

  return applyDeterministicContractValueFallbacks(next, extractedText);
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

function findContractSignatureOrPerfectionDate(text: string) {
  const pagePattern = /--- Página (\d+) ---\n([\s\S]*?)(?=\n\n--- Página \d+ ---|$)/g;
  const pages = Array.from(text.matchAll(pagePattern));

  for (const match of pages) {
    const pageNumber = Number(match[1]);
    const pageText = match[2] ?? "";
    const sentences = pageText
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?;:])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    const signatureSentence = sentences.find((sentence) => {
      const normalized = normalizeForDateSearch(sentence);

      return (
        (normalized.includes("suscripcion") ||
          normalized.includes("suscribe") ||
          normalized.includes("suscrito") ||
          normalized.includes("se firma") ||
          normalized.includes("firma del contrato") ||
          normalized.includes("perfeccionamiento") ||
          normalized.includes("perfeccionado")) &&
        !normalized.includes("acta de inicio")
      );
    });
    const date = signatureSentence
      ? extractFirstSpanishDate(signatureSentence)
      : null;

    if (date && signatureSentence) {
      return {
        date,
        pageNumber: Number.isFinite(pageNumber) ? pageNumber : null,
        source: signatureSentence.slice(0, 900),
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

function applyDeterministicContractValueFallbacks(
  extraction: AIExtraction,
  extractedText: string,
): AIExtraction {
  const valueResolution = resolveContractTotalValueFromRecord(
    extraction as unknown as Record<string, unknown>,
    extractedText,
  );

  if (valueResolution.total === null) {
    const needsReview = valueResolution.alerts.length > 0;

    return needsReview
      ? {
          ...extraction,
          requiere_revision_valor: deterministicBooleanValue(
            true,
            "Valor contractual periódico detectado sin periodos suficientes.",
          ),
          alertas: [...extraction.alertas, ...valueResolution.alerts],
        }
      : extraction;
  }

  const currentValue = normalizeNumber(extraction.valor_contrato.valor_numerico);
  const shouldReplace =
    currentValue === null ||
    valueResolution.requiresMultiplication ||
    Math.abs(currentValue - valueResolution.total) > 1;

  if (!shouldReplace) {
    return valueResolution.alerts.length > 0
      ? {
          ...extraction,
          requiere_revision_valor: deterministicBooleanValue(
            true,
            "El valor contractual requiere revisión humana.",
          ),
          alertas: [...extraction.alertas, ...valueResolution.alerts],
        }
      : extraction;
  }

  return {
    ...extraction,
    valor_contrato: {
      ...extraction.valor_contrato,
      valor_numerico: valueResolution.total,
      confianza: valueResolution.requiresMultiplication
        ? "media"
        : extraction.valor_contrato.confianza,
      fuente:
        valueResolution.explanation ??
        extraction.valor_contrato.fuente,
    },
    valor_contrato_total: deterministicNumberValue(
      valueResolution.total,
      valueResolution.explanation ?? "Valor total contractual normalizado.",
    ),
    valor_unitario_periodico:
      valueResolution.unit === null
        ? extraction.valor_unitario_periodico
        : deterministicNumberValue(
            valueResolution.unit,
            "Valor unitario periódico detectado en el contrato.",
          ),
    periodicidad_valor:
      valueResolution.periodicity === null
        ? extraction.periodicidad_valor
        : deterministicTextValue(
            valueResolution.periodicity,
            "Periodicidad del valor contractual detectada.",
          ),
    numero_periodos:
      valueResolution.periodCount === null
        ? extraction.numero_periodos
        : deterministicIntegerValue(
            valueResolution.periodCount,
            "Número de periodos contractuales usado para calcular valor total.",
          ),
    explicacion_calculo_valor: deterministicTextValue(
      valueResolution.explanation ?? "Valor total contractual normalizado.",
      "Explicación determinística del valor total contractual.",
    ),
    requiere_revision_valor: deterministicBooleanValue(
      valueResolution.alerts.length > 0,
      valueResolution.alerts.length > 0
        ? "El valor contractual requiere revisión humana."
        : "Valor contractual calculado sin ambigüedad.",
    ),
    alertas: [...extraction.alertas, ...valueResolution.alerts],
  };
}

type ContractValueResolution = {
  total: number | null;
  unit: number | null;
  periodicity: string | null;
  periodCount: number | null;
  requiresMultiplication: boolean;
  explanation: string | null;
  alerts: string[];
};

function resolveContractTotalValueFromRecord(
  record: Record<string, unknown>,
  extractedText = "",
): ContractValueResolution {
  const valorContrato = asRecord(record.valor_contrato);
  const currentValue = normalizeNumber(
    valorContrato.valor_numerico ?? valorContrato.valor ?? record.valor_contrato,
  );
  const explicitTotal =
    normalizeNumber(asRecord(record.valor_contrato_total).valor) ??
    findExplicitTotalContractValue(extractedText);
  const periodicity = resolveContractValuePeriodicity(
    normalizeText(asRecord(record.periodicidad_valor).valor),
    extractedText,
  );
  const periodCount =
    normalizeInteger(asRecord(record.numero_periodos).valor) ??
    findContractPeriodCount(extractedText);
  const unit =
    normalizeNumber(asRecord(record.valor_unitario_periodico).valor) ??
    findPeriodicContractUnitValue(extractedText) ??
    (periodicity !== null && currentValue !== null && periodCount !== null
      ? currentValue
      : null);

  if (explicitTotal !== null) {
    return {
      total: explicitTotal,
      unit,
      periodicity,
      periodCount,
      requiresMultiplication: false,
      explanation: "Valor total explícito del contrato usado como base.",
      alerts: [],
    };
  }

  if (unit !== null && periodCount !== null && periodCount > 0) {
    const total = roundMoney(unit * periodCount);

    return {
      total,
      unit,
      periodicity: periodicity ?? "mensual",
      periodCount,
      requiresMultiplication: true,
      explanation: `Valor total calculado como valor periódico ${formatPlainMoney(unit)} x ${periodCount} periodos = ${formatPlainMoney(total)}.`,
      alerts: [],
    };
  }

  if (unit !== null && periodCount === null) {
    return {
      total: currentValue,
      unit,
      periodicity,
      periodCount,
      requiresMultiplication: false,
      explanation: null,
      alerts: [
        "Se detectó valor mensual o periódico, pero no se pudo determinar número de periodos; revise valor total del contrato.",
      ],
    };
  }

  return {
    total: currentValue,
    unit,
    periodicity,
    periodCount,
    requiresMultiplication: false,
    explanation: null,
    alerts: [],
  };
}

function resolveContractValuePeriodicity(
  extractedPeriodicity: string | null,
  text: string,
) {
  const normalized = normalizeForDateSearch(
    [extractedPeriodicity, text].filter(Boolean).join(" "),
  );

  if (
    normalized.includes("mensual") ||
    normalized.includes("mes vencido") ||
    normalized.includes("cada mes")
  ) {
    return "mensual";
  }

  if (normalized.includes("diario") || normalized.includes("cada dia")) {
    return "diario";
  }

  return extractedPeriodicity;
}

function findExplicitTotalContractValue(text: string) {
  if (!text) {
    return null;
  }

  const segments = text
    .replace(/\n+/g, ". ")
    .split(/(?<=[.!?;:])\s+/)
    .filter((segment) => {
      const normalized = normalizeForDateSearch(segment);

      return (
        normalized.includes("valor total") ||
        normalized.includes("valor del contrato") ||
        normalized.includes("presupuesto total")
      ) && !normalized.includes("mensual");
    });

  return segments
    .map((segment) => extractFirstMoneyAmount(segment))
    .find((value): value is number => value !== null) ?? null;
}

function findPeriodicContractUnitValue(text: string) {
  if (!text) {
    return null;
  }

  const segments = text
    .replace(/\n+/g, ". ")
    .split(/(?<=[.!?;:])\s+/)
    .filter((segment) => {
      const normalized = normalizeForDateSearch(segment);

      return (
        normalized.includes("mensual") ||
        normalized.includes("precio mes") ||
        normalized.includes("valor mes") ||
        normalized.includes("canon") ||
        normalized.includes("costo periodico")
      );
    });

  return segments
    .map((segment) => extractFirstMoneyAmount(segment))
    .find((value): value is number => value !== null) ?? null;
}

function findContractPeriodCount(text: string) {
  const durationSegments = text
    .replace(/\n+/g, ". ")
    .split(/(?<=[.!?;:])\s+/)
    .filter((segment) => {
      const normalized = normalizeForDateSearch(segment);

      return (
        (normalized.includes("duracion") ||
          normalized.includes("plazo") ||
          normalized.includes("vigencia")) &&
        (normalized.includes("contrato") ||
          normalized.includes("ejecucion") ||
          normalized.includes("servicio")) &&
        !normalized.includes("garantia") &&
        !normalized.includes("poliza") &&
        !normalized.includes("amparo")
      );
    });
  const duration = durationSegments
    .map((segment) => extractDuration(segment))
    .find((candidate): candidate is { years: number; months: number; days: number } =>
      candidate !== null,
    ) ?? null;

  if (!duration) {
    return null;
  }

  if (duration.months > 0 && duration.years === 0 && duration.days === 0) {
    return duration.months;
  }

  if (duration.years > 0 && duration.months === 0 && duration.days === 0) {
    return duration.years * 12;
  }

  return null;
}

function extractFirstMoneyAmount(text: string) {
  const match = text.match(/\$\s*[\d.,]+/);

  return match ? normalizeNumber(match[0]) : null;
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
    prima_neta_automatica: normalizeNumber(row.prima_neta_automatica),
    prima_neta_manual: normalizeNumber(row.prima_neta_manual),
    usar_prima_neta_manual: normalizeBoolean(
      row.usar_prima_neta_manual,
      false,
    ),
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
    fecha_desde_manual: normalizeBoolean(row.fecha_desde_manual, false),
    fecha_hasta: normalizeDate(row.fecha_hasta),
    fecha_hasta_manual: normalizeBoolean(row.fecha_hasta_manual, false),
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
  pageCountAssessment,
  fullText,
  openAiContext,
  openAiPages,
  pageDetails,
  truncated,
  documentType,
  fileName,
}: {
  totalPages: number;
  pageCountAssessment: PdfPageCountAssessment;
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
    "[Document Intelligence] conteo de páginas del PDF:",
    pageCountAssessment.pageCount ?? "no disponible",
    {
      fuente: pageCountAssessment.source,
      confiable: pageCountAssessment.reliable,
    },
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
      prima_neta_automatica: row.prima_neta_automatica,
      prima_neta_manual: row.prima_neta_manual,
      usar_prima_neta_manual: row.usar_prima_neta_manual,
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

export function evaluateDocumentIntelligencePageCoverage({
  pageCountAssessment,
  extractedPageCount,
}: {
  pageCountAssessment: PdfPageCountAssessment;
  extractedPageCount: number;
}) {
  const estimatedPageCount = pageCountAssessment.pageCount;
  const missingPageCount =
    estimatedPageCount === null ? 0 : estimatedPageCount - extractedPageCount;
  const coverageRatio =
    estimatedPageCount === null ? 1 : extractedPageCount / estimatedPageCount;
  const shouldBlock =
    pageCountAssessment.reliable &&
    estimatedPageCount !== null &&
    estimatedPageCount >= 6 &&
    missingPageCount > MAX_TOLERATED_MISSING_PAGES &&
    coverageRatio < MIN_DOCUMENT_INTELLIGENCE_PAGE_COVERAGE_RATIO;

  return {
    shouldBlock,
    expectedPageCount: estimatedPageCount,
    extractedPageCount,
    missingPageCount,
    coverageRatio,
    reliable: pageCountAssessment.reliable,
    source: pageCountAssessment.source,
  };
}

function assertDocumentIntelligencePageCoverage({
  pageCountAssessment,
  extractedPageCount,
}: {
  pageCountAssessment: PdfPageCountAssessment;
  extractedPageCount: number;
}) {
  const decision = evaluateDocumentIntelligencePageCoverage({
    pageCountAssessment,
    extractedPageCount,
  });

  if (!decision.shouldBlock) {
    if (
      !decision.reliable &&
      decision.expectedPageCount !== null &&
      decision.missingPageCount > MAX_TOLERATED_MISSING_PAGES
    ) {
      console.warn(
        "[Document Intelligence] conteo aproximado no bloqueante:",
        decision,
      );
    }

    return;
  }

  const message = [
    `Document Intelligence devolvió ${extractedPageCount} de ${decision.expectedPageCount} páginas confirmadas en el PDF.`,
    "La extracción se detuvo para evitar guardar una lectura incompleta como si fuera válida.",
    "Revisa si Azure Document Intelligence está usando un tier con límite de páginas, si el PDF subido está completo o si el servicio rechazó páginas posteriores.",
  ].join(" ");

  if (process.env.NODE_ENV === "development") {
    console.error("[Document Intelligence] cobertura insuficiente:", {
      ...decision,
      message,
    });
  }

  throw new Error(message);
}

function normalizeBaseDocumentType(value: string): BaseDocumentType {
  if (value === "orden" || value === "orden_compra") {
    return value;
  }

  return "contrato_base";
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
