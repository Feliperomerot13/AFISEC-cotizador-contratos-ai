import type { Amparo, Cliente, Contrato, Cotizacion, Json } from "@/lib/database.types";
import { getExecutiveContact, type ExecutiveContact } from "@/lib/constants";
import {
  COVERAGE_POLICY_LABELS,
  COVERAGE_POLICY_ORDER,
  classifyCoveragePolicy,
  isCivilLiabilityName,
  type CoveragePolicy,
} from "@/lib/coverage-policy";

// v1: sin campo schema_version ni póliza por amparo. v2: agrupa por póliza.
export const QUOTE_SNAPSHOT_SCHEMA_VERSION = 2;

export type QuoteTotals = {
  prima_neta: number | null;
  iva: number | null;
  prima_total: number | null;
};

export type QuoteSnapshotAdditionalPeriod = {
  cantidad: number;
  unidad: "dias" | "meses" | "anios";
};

export type QuoteSnapshotCoverage = {
  tipo_amparo: string;
  poliza?: CoveragePolicy;
  // Solo si la fecha hasta salió de este periodo (no de una fecha manual); lo usa la renovación.
  periodo_adicional?: QuoteSnapshotAdditionalPeriod;
  valor_asegurado: number | null;
  valor_base_calculo: number | null;
  modo_calculo: string | null;
  fecha_desde: string | null;
  fecha_hasta: string | null;
  dias_vigencia: number | null;
  prima_neta: number | null;
  iva: number | null;
  prima_total: number | null;
  tasa: number | null;
  tasa_manual: boolean;
  subamparos: QuoteSnapshotSubcoverage[];
};

export type QuoteSnapshotSubcoverage = {
  nombre: string;
  incluido: boolean;
  calculable: boolean;
  porcentaje_sublimite: number | null;
  valor_sublimite: number | null;
};

export type QuoteSnapshotPolicySummary = {
  poliza: CoveragePolicy;
  nombre: string;
  totales: QuoteTotals;
};

export type QuoteSnapshot = {
  schema_version?: number;
  generado_en: string;
  cliente: {
    id: string | number;
    nombre: string;
    nit: string;
    ejecutivo: string;
  };
  comercial: ExecutiveContact | null;
  contrato: {
    id: string | number;
    numero_contrato: string | null;
    objeto: string | null;
    tipo_contrato: string | null;
    valor_contrato: number | null;
    base_calculo_amparos: number | null;
    base_calculo_incluye_iva: boolean | null;
    moneda: string;
    fecha_inicio: string | null;
    fecha_fin: string | null;
    plazo: string | null;
    contratante: string | null;
    contratante_nit: string | null;
    contratista: string | null;
    contratista_nit: string | null;
  };
  amparos: QuoteSnapshotCoverage[];
  // Suma de todas las pólizas; solo para compatibilidad con cotizaciones.total_*.
  totales: QuoteTotals;
  polizas?: QuoteSnapshotPolicySummary[];
  observaciones: string[];
};

export function buildQuoteSnapshot({
  contract,
  client,
  amparos,
  generatedAt,
}: {
  contract: Contrato;
  client: Cliente;
  amparos: Amparo[];
  generatedAt: string;
}): QuoteSnapshot {
  const coverages = amparos
    .filter((amparo) => amparo.modificacion_id === null)
    .map((amparo) => ({
      tipo_amparo: amparo.tipo_amparo,
      valor_asegurado: amparo.valor_asegurado,
      valor_base_calculo: amparo.valor_base_calculo,
      modo_calculo: amparo.modo_calculo,
      fecha_desde: amparo.fecha_desde,
      fecha_hasta: amparo.fecha_hasta,
      dias_vigencia: amparo.dias_vigencia,
      prima_neta: amparo.prima_neta,
      iva: amparo.impuesto,
      prima_total: amparo.prima_total,
      tasa: amparo.tasa,
      tasa_manual: amparo.tasa_manual,
      ...snapshotAdditionalPeriod(amparo),
      subamparos: parseQuoteSubcoverages(amparo.subamparos),
    }));
  const totals = calculateQuoteTotals(coverages);

  return applyPolicyStructure({
    generado_en: generatedAt,
    cliente: {
      id: client.id,
      nombre: client.nombre,
      nit: client.nit ?? "Sin dato",
      ejecutivo: client.ejecutivo,
    },
    comercial: getExecutiveContact(client.ejecutivo),
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
    amparos: coverages,
    totales: totals,
    observaciones: [
      "Cotizacion sujeta a revision y aprobacion final de la aseguradora.",
      "Esta cotizacion no constituye poliza emitida ni cobertura vigente hasta su expedicion formal por la aseguradora.",
    ],
  });
}

function snapshotAdditionalPeriod(
  amparo: Amparo,
): { periodo_adicional: QuoteSnapshotAdditionalPeriod } | Record<string, never> {
  const unit = amparo.periodo_adicional_unidad;
  const quantity = amparo.periodo_adicional_cantidad;

  if (
    amparo.fecha_hasta_manual ||
    quantity === null ||
    quantity === undefined ||
    (unit !== "dias" && unit !== "meses" && unit !== "anios")
  ) {
    return {};
  }

  return { periodo_adicional: { cantidad: quantity, unidad: unit } };
}

export function calculateQuoteTotals(coverages: QuoteSnapshotCoverage[]) {
  const prima_neta = sumNullable(coverages.map((coverage) => coverage.prima_neta));
  const iva = sumNullable(coverages.map((coverage) => coverage.iva));
  const prima_total = sumNullable(coverages.map((coverage) => coverage.prima_total));

  return { prima_neta, iva, prima_total };
}

export type QuotePolicyGroup = {
  poliza: CoveragePolicy;
  nombre: string;
  amparos: QuoteSnapshotCoverage[];
  totales: QuoteTotals;
};

export function getCoveragePolicy(coverage: QuoteSnapshotCoverage) {
  return coverage.poliza ?? classifyCoveragePolicy(coverage.tipo_amparo);
}

// Agrupa por póliza; sirve igual para snapshots v1 (sin campo poliza) y v2.
export function groupQuoteCoveragesByPolicy(
  coverages: QuoteSnapshotCoverage[],
): QuotePolicyGroup[] {
  return COVERAGE_POLICY_ORDER.flatMap((poliza) => {
    const amparos = coverages.filter(
      (coverage) => getCoveragePolicy(coverage) === poliza,
    );

    return amparos.length === 0
      ? []
      : [
          {
            poliza,
            nombre: COVERAGE_POLICY_LABELS[poliza],
            amparos,
            totales: calculateQuoteTotals(amparos),
          },
        ];
  });
}

// Marca cada amparo con su póliza y registra el resumen por póliza (snapshot v2).
export function applyPolicyStructure(snapshot: QuoteSnapshot): QuoteSnapshot {
  const amparos = snapshot.amparos.map((coverage) => ({
    ...coverage,
    poliza: getCoveragePolicy(coverage),
  }));

  return {
    ...snapshot,
    schema_version: QUOTE_SNAPSHOT_SCHEMA_VERSION,
    amparos,
    polizas: groupQuoteCoveragesByPolicy(amparos).map((group) => ({
      poliza: group.poliza,
      nombre: group.nombre,
      totales: group.totales,
    })),
  };
}

export function buildQuoteNumber(contractId: string | number, generatedAt: string) {
  const year = new Date(generatedAt).getFullYear();
  const suffix = String(contractId)
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 8)
    .toUpperCase();

  return `COT-${year}-${suffix || "AFISEC"}`;
}

export function getNextQuoteVersion(
  versions: Array<number | null | undefined>,
) {
  const maxVersion = versions.reduce<number>(
    (currentMax, version) =>
      typeof version === "number" && Number.isFinite(version)
        ? Math.max(currentMax, version)
        : currentMax,
    0,
  );

  return maxVersion + 1;
}

export function canDeleteGeneratedQuote(
  quote: Pick<Cotizacion, "estado" | "fecha_emision" | "fecha_reversion">,
) {
  return (
    quote.estado === "generada" &&
    quote.fecha_emision === null &&
    quote.fecha_reversion === null
  );
}

export function getQuoteSnapshot(quote: Pick<Cotizacion, "snapshot">) {
  if (!quote.snapshot || typeof quote.snapshot !== "object" || Array.isArray(quote.snapshot)) {
    return null;
  }

  return quote.snapshot as unknown as QuoteSnapshot;
}

export function snapshotToJson(snapshot: QuoteSnapshot) {
  return snapshot as unknown as Json;
}

export function getQuoteCommercialIssues(snapshot: QuoteSnapshot) {
  return snapshot.amparos.flatMap((coverage) => {
    const missingFields: string[] = [];

    if (isMissingNumber(coverage.valor_asegurado)) {
      missingFields.push("valor asegurado");
    }

    if (!coverage.fecha_desde) {
      missingFields.push("vigencia desde");
    }

    if (!coverage.fecha_hasta) {
      missingFields.push("vigencia hasta");
    }

    if (isMissingNumber(coverage.prima_neta)) {
      missingFields.push("prima neta");
    }

    if (isMissingNumber(coverage.iva)) {
      missingFields.push("IVA");
    }

    if (isMissingNumber(coverage.prima_total)) {
      missingFields.push("prima total");
    }

    if (missingFields.length === 0) {
      return [];
    }

    return [
      `${formatCoverageName(coverage.tipo_amparo)}: falta ${missingFields.join(", ")}.`,
    ];
  });
}

export function quoteStatusLabel(status: string) {
  const labels: Record<string, string> = {
    generada: "Generada",
    emitida: "Emitida",
    emision_revertida: "Emisión revertida",
    anulada: "Anulada",
  };

  return labels[status] ?? status;
}

export function formatCoverageName(value: string) {
  const normalized = normalizeCoverageKey(value);
  const labels: Record<string, string> = {
    cumplimiento: "Cumplimiento",
    buen_manejo_anticipo: "Buen manejo de anticipo",
    salarios_y_prestaciones_sociales: "Salarios y prestaciones sociales",
    calidad_y_estabilidad_del_servicio: "Calidad y estabilidad del servicio",
    rce: "Responsabilidad civil extracontractual",
    plo: "Responsabilidad civil extracontractual",
    responsabilidad_civil_extracontractual:
      "Responsabilidad civil extracontractual",
  };

  return labels[normalized] ?? titleCaseCoverageName(value);
}

export function isCivilLiabilityCoverageType(value: string) {
  return isCivilLiabilityName(value);
}

function normalizeCoverageKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function sumNullable(values: Array<number | null>) {
  const presentValues = values.filter((value): value is number => value !== null);

  if (presentValues.length === 0) {
    return null;
  }

  return roundMoney(presentValues.reduce((total, value) => total + value, 0));
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isMissingNumber(value: number | null | undefined) {
  return value === null || typeof value === "undefined" || !Number.isFinite(value);
}

function titleCaseCoverageName(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function parseQuoteSubcoverages(value: Json): QuoteSnapshotSubcoverage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }

      const record = item as Record<string, unknown>;
      const nombre = textOrNull(record.nombre);

      if (!nombre) {
        return null;
      }

      return {
        nombre,
        incluido: booleanOrDefault(record.incluido, true),
        calculable: booleanOrDefault(record.calculable, false),
        porcentaje_sublimite: numberOrNull(record.porcentaje_sublimite),
        valor_sublimite: numberOrNull(record.valor_sublimite),
      };
    })
    .filter((item): item is QuoteSnapshotSubcoverage => item !== null);
}

function textOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/\./g, "").replace(",", "."));

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function booleanOrDefault(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}
