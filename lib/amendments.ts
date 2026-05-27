import {
  DEFAULT_COVERAGE_RATE,
  DEFAULT_IVA_PERCENTAGE,
  DEFAULT_RCE_RATE,
} from "@/lib/constants";
import type {
  Amparo,
  Cliente,
  Contrato,
  Cotizacion,
  CotizacionAjuste,
  Json,
  ModificacionContractual,
} from "@/lib/database.types";
import {
  formatCoverageName,
  getQuoteSnapshot,
  type QuoteSnapshot,
  type QuoteSnapshotSubcoverage,
} from "@/lib/quotes";

export const TERMINAL_AMENDMENT_STATES = [
  "endoso_emitido",
  "no_aplicable",
  "anulado",
] as const;

export const NON_TERMINAL_AMENDMENT_STATES = [
  "cargado",
  "procesando",
  "pendiente_revision",
  "validado",
  "cotizado",
  "error",
  "pendiente_aplicacion",
] as const;

export type AmendmentLiquidationRow = {
  tipo_amparo: string;
  nombre_amparo: string;
  es_rce: boolean;
  valor_asegurado_vigente: number | null;
  valor_asegurado_adicion: number | null;
  valor_asegurado_acumulado: number | null;
  fecha_desde: string | null;
  fecha_hasta_anterior: string | null;
  fecha_hasta: string | null;
  dias_vigencia_adicion: number;
  dias_prorroga: number;
  tasa_aplicada: number;
  prima_valor_adicionado: number;
  prima_prorroga: number;
  prima_neta: number;
  iva: number;
  prima_total: number;
  subamparos: QuoteSnapshotSubcoverage[];
  observaciones: string[];
};

export type AmendmentLiquidation = {
  generado_en: string;
  moneda: string;
  valor_contrato_anterior: number | null;
  valor_adicion: number;
  valor_contrato_acumulado: number | null;
  fecha_fin_anterior: string | null;
  nueva_fecha_fin: string | null;
  dias_prorroga: number;
  rows: AmendmentLiquidationRow[];
  totales: {
    prima_valor_adicionado: number;
    prima_prorroga: number;
    prima_neta: number;
    iva: number;
    prima_total: number;
  };
  alertas: string[];
};

export type AmendmentTotalsBlock = {
  prima_valor_adicionado: number;
  prima_prorroga: number;
  prima_neta: number;
  iva: number;
  prima_total: number;
};

export type AmendmentActiveCoverage = {
  tipo_amparo: string;
  porcentaje: number | null;
  valor_asegurado: number | null;
  valor_base_calculo: number | null;
  tasa: number | null;
  iva_porcentaje: number;
  fecha_desde: string | null;
  fecha_hasta: string | null;
  dias_vigencia: number | null;
  subamparos: QuoteSnapshotSubcoverage[];
};

export type AmendmentActiveState = {
  fuente: {
    tipo: "poliza_base" | "endoso";
    id: string | number;
    numero: string;
    version: number;
  };
  cliente: QuoteSnapshot["cliente"];
  contrato: QuoteSnapshot["contrato"];
  amparos: AmendmentActiveCoverage[];
};

export type AmendmentQuoteSnapshot = {
  generado_en: string;
  numero_cotizacion: string;
  version: number;
  cliente: QuoteSnapshot["cliente"];
  contrato: QuoteSnapshot["contrato"];
  poliza_base: {
    id: string | number;
    numero_cotizacion: string;
    version: number;
    fecha_emision: string | null;
  };
  modificacion: {
    id: string | number;
    secuencia: number;
    numero_modificacion: string | null;
    tipo_modificacion: string | null;
    fecha_firma: string | null;
    valor_contrato_anterior: number | null;
    valor_adicion: number | null;
    valor_contrato_acumulado: number | null;
    fecha_fin_anterior: string | null;
    nueva_fecha_fin: string | null;
    dias_prorroga: number | null;
    objeto_nuevo: string | null;
    requiere_ajuste_garantias: boolean;
  };
  estado_vigente_anterior: AmendmentActiveState;
  liquidacion: AmendmentLiquidation;
  estado_vigente_resultante: AmendmentActiveState;
  observaciones: string[];
  alertas: string[];
};

export function amendmentStatusLabel(status: string) {
  const labels: Record<string, string> = {
    cargado: "En revisión",
    procesando: "En revisión",
    pendiente_revision: "En revisión",
    validado: "En revisión",
    cotizado: "Cotización generada",
    endoso_emitido: "Otrosí emitido",
    no_aplicable: "Eliminado",
    anulado: "Eliminado",
    error: "Error de revisión",
    pendiente_aplicacion: "En revisión",
  };

  return labels[status] ?? status;
}

export function amendmentQuoteStatusLabel(status: string) {
  const labels: Record<string, string> = {
    generada: "Generada",
    endoso_emitido: "Otrosí emitido",
    emision_revertida: "Emisión revertida",
    anulada: "Eliminada",
  };

  return labels[status] ?? status;
}

export function isTerminalAmendmentState(status: string) {
  return TERMINAL_AMENDMENT_STATES.includes(
    status as (typeof TERMINAL_AMENDMENT_STATES)[number],
  );
}

export function buildAmendmentQuoteNumber({
  contractId,
  sequence,
  generatedAt,
}: {
  contractId: string | number;
  sequence: number;
  generatedAt: string;
}) {
  const year = new Date(generatedAt).getFullYear();
  const suffix = String(contractId)
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 8)
    .toUpperCase();

  return `AJ-COT-${year}-${suffix || "AFISEC"}-OT${sequence}`;
}

export function buildBaseActiveState({
  baseQuote,
  amparos,
}: {
  baseQuote: Cotizacion;
  amparos: Amparo[];
}): AmendmentActiveState {
  const snapshot = getQuoteSnapshot(baseQuote);

  if (!snapshot) {
    throw new Error("La póliza base emitida no tiene snapshot válido.");
  }

  const baseCoverages = amparos
    .filter((amparo) => amparo.modificacion_id === null)
    .map((amparo) => ({
      tipo_amparo: amparo.tipo_amparo,
      porcentaje: amparo.porcentaje,
      valor_asegurado: amparo.valor_asegurado,
      valor_base_calculo: amparo.valor_base_calculo,
      tasa: amparo.tasa,
      iva_porcentaje: amparo.iva_porcentaje ?? DEFAULT_IVA_PERCENTAGE,
      fecha_desde: amparo.fecha_desde,
      fecha_hasta: amparo.fecha_hasta,
      dias_vigencia: amparo.dias_vigencia,
      subamparos: parseSubcoverages(amparo.subamparos),
    }));

  return {
    fuente: {
      tipo: "poliza_base",
      id: baseQuote.id,
      numero: baseQuote.numero_cotizacion,
      version: baseQuote.version,
    },
    cliente: snapshot.cliente,
    contrato: snapshot.contrato,
    amparos: baseCoverages,
  };
}

export function getActiveStateFromEndorsements({
  baseQuote,
  amparos,
  adjustmentQuotes,
  beforeSequence,
}: {
  baseQuote: Cotizacion;
  amparos: Amparo[];
  adjustmentQuotes: CotizacionAjuste[];
  beforeSequence?: number | null;
}) {
  const baseState = buildBaseActiveState({ baseQuote, amparos });
  const emitted = adjustmentQuotes
    .map((quote) => getAmendmentQuoteSnapshot(quote))
    .filter((snapshot): snapshot is AmendmentQuoteSnapshot => {
      if (!snapshot) {
        return false;
      }

      if (typeof beforeSequence === "number") {
        return snapshot.modificacion.secuencia < beforeSequence;
      }

      return true;
    })
    .sort(
      (left, right) =>
        left.modificacion.secuencia - right.modificacion.secuencia,
    );

  return emitted.at(-1)?.estado_vigente_resultante ?? baseState;
}

export function calculateAmendmentLiquidation({
  activeState,
  modification,
  rateOverrides = {},
  generatedAt,
}: {
  activeState: AmendmentActiveState;
  modification: Pick<
    ModificacionContractual,
    | "valor_contrato_anterior"
    | "valor_adicion"
    | "valor_contrato_acumulado"
    | "fecha_desde"
    | "fecha_hasta"
    | "dias_prorroga"
  >;
  rateOverrides?: Record<string, number | null | undefined>;
  generatedAt: string;
}): AmendmentLiquidation {
  const previousContractValue =
    finiteOrNull(modification.valor_contrato_anterior) ??
    finiteOrNull(activeState.contrato.base_calculo_amparos) ??
    finiteOrNull(activeState.contrato.valor_contrato);
  const addedValue = finiteOrNull(modification.valor_adicion) ?? 0;
  const accumulatedValue =
    finiteOrNull(modification.valor_contrato_acumulado) ??
    (previousContractValue === null ? null : previousContractValue + addedValue);
  const previousEndDate =
    modification.fecha_desde ?? activeState.contrato.fecha_fin ?? null;
  const newEndDate =
    modification.fecha_hasta ?? activeState.contrato.fecha_fin ?? null;
  const calculatedExtensionDays = daysBetweenDateOnly(
    previousEndDate,
    newEndDate,
  );
  const reviewedExtensionDays = finiteOrNull(modification.dias_prorroga);
  const extensionDays =
    calculatedExtensionDays ??
    reviewedExtensionDays ??
    0;
  const alertas: string[] = [];

  if (
    calculatedExtensionDays !== null &&
    reviewedExtensionDays !== null &&
    reviewedExtensionDays !== calculatedExtensionDays
  ) {
    alertas.push(
      calculatedExtensionDays === 0
        ? "No se pudo derivar la prórroga desde las fechas revisadas. Revise fecha fin anterior, nueva fecha fin y días de prórroga antes de emitir."
        : `Los días de prórroga se derivaron de las fechas revisadas (${calculatedExtensionDays}). El valor anterior (${reviewedExtensionDays}) quedó como referencia de revisión.`,
    );
  }

  if (
    previousEndDate &&
    activeState.contrato.fecha_fin &&
    previousEndDate !== activeState.contrato.fecha_fin
  ) {
    alertas.push(
      `La fecha fin anterior del otrosí (${previousEndDate}) no coincide con la fecha fin vigente de la póliza (${activeState.contrato.fecha_fin}). Revise la secuencia antes de emitir.`,
    );
  }

  const rows = activeState.amparos.map((coverage) => {
    const esRce = isCivilLiabilityCoverage(coverage.tipo_amparo);
    const normalizedKey = normalizeCoverageKey(coverage.tipo_amparo);
    const override = rateOverrides[normalizedKey] ?? rateOverrides[coverage.tipo_amparo];
    const rate =
      finiteOrNull(override) ??
      finiteOrNull(coverage.tasa) ??
      (esRce ? DEFAULT_RCE_RATE : DEFAULT_COVERAGE_RATE);
    const ivaPercentage =
      finiteOrNull(coverage.iva_porcentaje) ?? DEFAULT_IVA_PERCENTAGE;
    const percentage = finiteOrNull(coverage.porcentaje);
    const currentInsuredValue = finiteOrNull(coverage.valor_asegurado);
    const addedInsuredValue = esRce
      ? 0
      : percentage === null
        ? 0
        : roundMoney(addedValue * percentage);
    const accumulatedInsuredValue = esRce
      ? currentInsuredValue
      : percentage !== null && accumulatedValue !== null
        ? roundMoney(accumulatedValue * percentage)
        : currentInsuredValue === null
          ? addedInsuredValue
          : roundMoney(currentInsuredValue + addedInsuredValue);
    const adjustedCoverageEndDate = resolveAdjustedCoverageEndDate({
      coverage,
      previousEndDate,
      newEndDate,
    });
    const additionDays =
      addedValue > 0
        ? daysBetweenDateOnly(coverage.fecha_desde, adjustedCoverageEndDate) ??
          coverage.dias_vigencia ??
          extensionDays
        : 0;
    const premiumByAddition = esRce
      ? 0
      : roundMoney((addedInsuredValue * rate * Math.max(additionDays, 0)) / 365);
    const premiumByExtension =
      accumulatedInsuredValue === null
        ? 0
        : roundMoney(
            (accumulatedInsuredValue * rate * Math.max(extensionDays, 0)) / 365,
          );
    const netPremium = roundMoney(premiumByAddition + premiumByExtension);
    const iva = roundMoney(netPremium * ivaPercentage);
    const total = roundMoney(netPremium + iva);

    return {
      tipo_amparo: coverage.tipo_amparo,
      nombre_amparo: formatCoverageName(coverage.tipo_amparo),
      es_rce: esRce,
      valor_asegurado_vigente: currentInsuredValue,
      valor_asegurado_adicion: addedInsuredValue,
      valor_asegurado_acumulado: accumulatedInsuredValue,
      fecha_desde: coverage.fecha_desde,
      fecha_hasta_anterior: coverage.fecha_hasta,
      fecha_hasta: adjustedCoverageEndDate ?? coverage.fecha_hasta,
      dias_vigencia_adicion: Math.max(additionDays, 0),
      dias_prorroga: Math.max(extensionDays, 0),
      tasa_aplicada: rate,
      prima_valor_adicionado: premiumByAddition,
      prima_prorroga: premiumByExtension,
      prima_neta: netPremium,
      iva,
      prima_total: total,
      subamparos: coverage.subamparos,
      observaciones: esRce
        ? [
            "RCE/PLO se liquida como línea principal; los subamparos son informativos.",
          ]
        : [],
    } satisfies AmendmentLiquidationRow;
  });

  return {
    generado_en: generatedAt,
    moneda: activeState.contrato.moneda,
    valor_contrato_anterior: previousContractValue,
    valor_adicion: addedValue,
    valor_contrato_acumulado: accumulatedValue,
    fecha_fin_anterior: previousEndDate,
    nueva_fecha_fin: newEndDate,
    dias_prorroga: Math.max(extensionDays, 0),
    rows,
    totales: {
      prima_valor_adicionado: roundMoney(
        rows.reduce((total, row) => total + row.prima_valor_adicionado, 0),
      ),
      prima_prorroga: roundMoney(
        rows.reduce((total, row) => total + row.prima_prorroga, 0),
      ),
      prima_neta: roundMoney(rows.reduce((total, row) => total + row.prima_neta, 0)),
      iva: roundMoney(rows.reduce((total, row) => total + row.iva, 0)),
      prima_total: roundMoney(
        rows.reduce((total, row) => total + row.prima_total, 0),
      ),
    },
    alertas,
  };
}

export function calculateAmendmentTotalsByBlock(
  rows: AmendmentLiquidationRow[],
) {
  const civilLiabilityRows = rows.filter(
    (row) => row.es_rce || isCivilLiabilityCoverage(row.tipo_amparo),
  );
  const guaranteeRows = rows.filter(
    (row) => !civilLiabilityRows.includes(row),
  );

  return {
    garantias: calculateAmendmentGroupTotals(guaranteeRows),
    responsabilidad_civil: calculateAmendmentGroupTotals(civilLiabilityRows),
    general: calculateAmendmentGroupTotals(rows),
  };
}

function calculateAmendmentGroupTotals(
  rows: AmendmentLiquidationRow[],
): AmendmentTotalsBlock {
  return {
    prima_valor_adicionado: roundMoney(
      rows.reduce((total, row) => total + row.prima_valor_adicionado, 0),
    ),
    prima_prorroga: roundMoney(
      rows.reduce((total, row) => total + row.prima_prorroga, 0),
    ),
    prima_neta: roundMoney(rows.reduce((total, row) => total + row.prima_neta, 0)),
    iva: roundMoney(rows.reduce((total, row) => total + row.iva, 0)),
    prima_total: roundMoney(rows.reduce((total, row) => total + row.prima_total, 0)),
  };
}

export function buildResultingActiveState({
  activeState,
  modification,
  quoteId,
  quoteNumber,
  version,
  liquidation,
}: {
  activeState: AmendmentActiveState;
  modification: Pick<
    ModificacionContractual,
    | "id"
    | "secuencia"
    | "valor_contrato_acumulado"
    | "fecha_hasta"
    | "objeto_nuevo"
  >;
  quoteId: string | number;
  quoteNumber: string;
  version: number;
  liquidation: AmendmentLiquidation;
}): AmendmentActiveState {
  return {
    fuente: {
      tipo: "endoso",
      id: quoteId,
      numero: quoteNumber,
      version,
    },
    cliente: activeState.cliente,
    contrato: {
      ...activeState.contrato,
      valor_contrato:
        liquidation.valor_contrato_acumulado ??
        activeState.contrato.valor_contrato,
      base_calculo_amparos:
        liquidation.valor_contrato_acumulado ??
        activeState.contrato.base_calculo_amparos,
      fecha_fin: modification.fecha_hasta ?? activeState.contrato.fecha_fin,
      objeto: modification.objeto_nuevo ?? activeState.contrato.objeto,
    },
    amparos: activeState.amparos.map((coverage) => {
      const row = liquidation.rows.find(
        (item) => normalizeCoverageKey(item.tipo_amparo) ===
          normalizeCoverageKey(coverage.tipo_amparo),
      );

      return {
        ...coverage,
        valor_asegurado:
          row?.valor_asegurado_acumulado ?? coverage.valor_asegurado,
        fecha_hasta: row?.fecha_hasta ?? coverage.fecha_hasta,
        dias_vigencia:
          row?.dias_vigencia_adicion ?? coverage.dias_vigencia,
      };
    }),
  };
}

export function buildAmendmentQuoteSnapshot({
  quoteNumber,
  version,
  generatedAt,
  client,
  contract,
  baseQuote,
  modification,
  activeState,
  liquidation,
}: {
  quoteNumber: string;
  version: number;
  generatedAt: string;
  client: Cliente;
  contract: Contrato;
  baseQuote: Cotizacion;
  modification: ModificacionContractual;
  activeState: AmendmentActiveState;
  liquidation: AmendmentLiquidation;
}): AmendmentQuoteSnapshot {
  const baseSnapshot = getQuoteSnapshot(baseQuote);

  if (!baseSnapshot) {
    throw new Error("La póliza base emitida no tiene snapshot válido.");
  }

  const sequence = modification.secuencia ?? 1;
  const resultingState = buildResultingActiveState({
    activeState,
    modification,
    quoteId: "pendiente",
    quoteNumber,
    version,
    liquidation,
  });
  const alertas = [
    ...liquidation.alertas,
    ...jsonStringArray(modification.alertas),
    hasStampTaxAlert(modification.alertas)
      ? "Impuesto de timbre detectado como alerta informativa; no se suma a la prima."
      : null,
  ].filter((item): item is string => Boolean(item));

  return {
    generado_en: generatedAt,
    numero_cotizacion: quoteNumber,
    version,
    cliente: {
      id: client.id,
      nombre: client.nombre,
      nit: client.nit ?? "Sin dato",
      ejecutivo: client.ejecutivo,
    },
    contrato: {
      id: contract.id,
      numero_contrato: contract.numero_contrato,
      objeto: contract.objeto,
      tipo_contrato: contract.tipo_contrato,
      valor_contrato: contract.valor_contrato,
      base_calculo_amparos: contract.base_calculo_amparos,
      base_calculo_incluye_iva: contract.base_calculo_incluye_iva,
      moneda: contract.moneda,
      fecha_inicio: contract.fecha_inicio,
      fecha_fin: contract.fecha_fin,
      plazo: contract.plazo,
      contratante: contract.contratante,
      contratante_nit: contract.contratante_nit,
      contratista: contract.contratista,
      contratista_nit: contract.contratista_nit,
    },
    poliza_base: {
      id: baseQuote.id,
      numero_cotizacion: baseQuote.numero_cotizacion,
      version: baseQuote.version,
      fecha_emision: baseQuote.fecha_emision,
    },
    modificacion: {
      id: modification.id,
      secuencia: sequence,
      numero_modificacion: modification.numero_modificacion,
      tipo_modificacion: modification.tipo_modificacion,
      fecha_firma: modification.fecha_firma,
      valor_contrato_anterior: liquidation.valor_contrato_anterior,
      valor_adicion: modification.valor_adicion,
      valor_contrato_acumulado: liquidation.valor_contrato_acumulado,
      fecha_fin_anterior: liquidation.fecha_fin_anterior,
      nueva_fecha_fin: liquidation.nueva_fecha_fin,
      dias_prorroga: liquidation.dias_prorroga,
      objeto_nuevo: modification.objeto_nuevo,
      requiere_ajuste_garantias: modification.requiere_ajuste_garantias,
    },
    estado_vigente_anterior: activeState,
    liquidacion: liquidation,
    estado_vigente_resultante: resultingState,
    observaciones: [
      "Cotización de ajuste sujeta a aprobación final de la aseguradora.",
      "Esta cotización no constituye otrosí emitido ni cobertura vigente hasta su expedición formal.",
    ],
    alertas,
  };
}

export function getAmendmentQuoteSnapshot(
  quote: Pick<CotizacionAjuste, "snapshot">,
) {
  if (!quote.snapshot || typeof quote.snapshot !== "object" || Array.isArray(quote.snapshot)) {
    return null;
  }

  return quote.snapshot as unknown as AmendmentQuoteSnapshot;
}

export function amendmentSnapshotToJson(snapshot: AmendmentQuoteSnapshot) {
  return snapshot as unknown as Json;
}

export function liquidationToJson(liquidation: AmendmentLiquidation) {
  return liquidation as unknown as Json;
}

export function activeStateToJson(state: AmendmentActiveState) {
  return state as unknown as Json;
}

export function jsonToLiquidation(value: Json): AmendmentLiquidation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (!Array.isArray(record.rows) || !record.totales) {
    return null;
  }

  return value as unknown as AmendmentLiquidation;
}

export function getAmendmentCommercialIssues(liquidation: AmendmentLiquidation) {
  return liquidation.rows.flatMap((row) => {
    const missing: string[] = [];

    if (row.valor_asegurado_acumulado === null) {
      missing.push("valor asegurado acumulado");
    }

    if (!row.fecha_hasta) {
      missing.push("vigencia hasta");
    }

    if (!Number.isFinite(row.prima_total)) {
      missing.push("prima total");
    }

    return missing.length === 0
      ? []
      : [`${row.nombre_amparo}: falta ${missing.join(", ")}.`];
  });
}

export function getBasePolicyEndorsementIssues({
  activeState,
  baseQuote,
  contract,
}: {
  activeState: AmendmentActiveState;
  baseQuote: Cotizacion;
  contract: Pick<Contrato, "fecha_inicio" | "fecha_fin">;
}) {
  const snapshot = getQuoteSnapshot(baseQuote);

  if (!snapshot) {
    return ["La póliza base emitida no tiene snapshot válido; revise antes de generar otrosí."];
  }

  const issues: string[] = [];

  if (!snapshot.contrato.fecha_inicio || !snapshot.contrato.fecha_fin) {
    issues.push(
      "La póliza base emitida no tiene vigencia general completa; revise antes de generar otrosí.",
    );
  }

  if (
    contract.fecha_fin &&
    snapshot.contrato.fecha_fin &&
    contract.fecha_fin !== snapshot.contrato.fecha_fin
  ) {
    issues.push(
      `La póliza base emitida tiene fecha fin ${snapshot.contrato.fecha_fin}, pero el contrato vigente registra ${contract.fecha_fin}; revise antes de generar otrosí.`,
    );
  }

  const snapshotRce = snapshot.amparos.filter((coverage) =>
    isCivilLiabilityCoverage(coverage.tipo_amparo),
  );
  const activeRce = activeState.amparos.filter((coverage) =>
    isCivilLiabilityCoverage(coverage.tipo_amparo),
  );

  if (snapshotRce.length > 0 || activeRce.length > 0) {
    const hasIncompleteSnapshotRce =
      snapshotRce.length === 0 ||
      snapshotRce.some(
        (coverage) =>
          !isPositiveNumber(coverage.valor_asegurado) ||
          !coverage.fecha_desde ||
          !coverage.fecha_hasta ||
          !isPositiveNumber(coverage.prima_total),
      );
    const hasIncompleteActiveRce = activeRce.some(
      (coverage) =>
        !isPositiveNumber(coverage.valor_asegurado) ||
        !coverage.fecha_desde ||
        !coverage.fecha_hasta,
    );

    if (hasIncompleteSnapshotRce || hasIncompleteActiveRce) {
      issues.push(
        "La póliza base emitida no tiene RCE/PLO completo; revise antes de generar otrosí.",
      );
    }
  }

  return [...new Set(issues)];
}

export function normalizeCoverageKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function isCivilLiabilityCoverage(value: string) {
  const normalized = normalizeCoverageKey(value);

  return (
    normalized.includes("responsabilidad_civil") ||
    normalized.includes("extracontractual") ||
    normalized.includes("rce") ||
    normalized.includes("plo")
  );
}

function parseSubcoverages(value: Json): QuoteSnapshotSubcoverage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }

      const record = item as Record<string, unknown>;
      const nombre =
        typeof record.nombre === "string" && record.nombre.trim()
          ? record.nombre.trim()
          : null;

      if (!nombre) {
        return null;
      }

      return {
        nombre,
        incluido:
          typeof record.incluido === "boolean" ? record.incluido : true,
        calculable:
          typeof record.calculable === "boolean" ? record.calculable : false,
        porcentaje_sublimite: finiteOrNull(record.porcentaje_sublimite),
        valor_sublimite: finiteOrNull(record.valor_sublimite),
      };
    })
    .filter((item): item is QuoteSnapshotSubcoverage => item !== null);
}

function jsonStringArray(value: Json) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function hasStampTaxAlert(value: Json) {
  return jsonStringArray(value).some((alert) =>
    normalizeCoverageKey(alert).includes("timbre"),
  );
}

function finiteOrNull(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/\./g, "").replace(",", "."));

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function isPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function daysBetweenDateOnly(start: string | null, end: string | null) {
  if (!start || !end) {
    return null;
  }

  const startTime = Date.parse(`${start.slice(0, 10)}T00:00:00.000Z`);
  const endTime = Date.parse(`${end.slice(0, 10)}T00:00:00.000Z`);

  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return null;
  }

  return Math.max(0, Math.round((endTime - startTime) / 86_400_000));
}

function resolveAdjustedCoverageEndDate({
  coverage,
  previousEndDate,
  newEndDate,
}: {
  coverage: AmendmentActiveCoverage;
  previousEndDate: string | null;
  newEndDate: string | null;
}) {
  if (!newEndDate) {
    return coverage.fecha_hasta;
  }

  if (!previousEndDate || !coverage.fecha_hasta) {
    return newEndDate;
  }

  const tailDays = daysBetweenDateOnly(previousEndDate, coverage.fecha_hasta);

  if (tailDays === null || tailDays <= 0) {
    return newEndDate;
  }

  return addDaysDateOnly(newEndDate, tailDays) ?? newEndDate;
}

function addDaysDateOnly(value: string, days: number) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);

  if (!Number.isFinite(date.getTime()) || !Number.isFinite(days)) {
    return null;
  }

  date.setUTCDate(date.getUTCDate() + Math.trunc(days));

  return date.toISOString().slice(0, 10);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
