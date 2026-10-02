import { addDaysToDateOnly, addPeriodToDateOnly, diffDaysDateOnly } from "@/lib/date-only";
import {
  applyPolicyStructure,
  calculateQuoteTotals,
  type QuoteSnapshot,
  type QuoteSnapshotCoverage,
} from "@/lib/quotes";

export function buildRenewalSnapshot({
  baseSnapshot,
  generatedAt,
  fechaInicio,
  fechaFin,
}: {
  baseSnapshot: QuoteSnapshot;
  generatedAt: string;
  fechaInicio: string;
  fechaFin: string;
}) {
  const amparos = baseSnapshot.amparos.map((coverage) =>
    recalculateRenewalCoverage({
      coverage,
      previousContractEnd: baseSnapshot.contrato.fecha_fin,
      renewalStart: fechaInicio,
      renewalEnd: fechaFin,
    }),
  );

  return applyPolicyStructure({
    ...baseSnapshot,
    generado_en: generatedAt,
    contrato: {
      ...baseSnapshot.contrato,
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
    },
    amparos,
    totales: calculateQuoteTotals(amparos),
    observaciones: [
      "Cotización de prórroga generada sobre póliza emitida renovable.",
      ...baseSnapshot.observaciones,
    ],
  } satisfies QuoteSnapshot);
}

function recalculateRenewalCoverage({
  coverage,
  previousContractEnd,
  renewalStart,
  renewalEnd,
}: {
  coverage: QuoteSnapshotCoverage;
  previousContractEnd: string | null;
  renewalStart: string;
  renewalEnd: string;
}): QuoteSnapshotCoverage {
  // Un periodo con unidad se reaplica sobre la nueva fecha fin; sin él, se conserva la diferencia en días.
  const fechaHasta = coverage.periodo_adicional
    ? (addPeriodToDateOnly(
        renewalEnd,
        coverage.periodo_adicional.cantidad,
        coverage.periodo_adicional.unidad,
      ) ?? renewalEnd)
    : (addDaysToDateOnly(
        renewalEnd,
        previousContractEnd && coverage.fecha_hasta
          ? Math.max(0, diffDaysDateOnly(previousContractEnd, coverage.fecha_hasta) ?? 0)
          : 0,
      ) ?? renewalEnd);
  const diasVigencia = diffDaysDateOnly(renewalStart, fechaHasta);
  const premium = calculatePremium({
    insuredValue: coverage.valor_asegurado,
    rate: coverage.tasa,
    validityDays: diasVigencia,
    ivaPercentage: inferIvaPercentage(coverage),
  });

  return {
    ...coverage,
    fecha_desde: renewalStart,
    fecha_hasta: fechaHasta,
    dias_vigencia: diasVigencia,
    prima_neta: premium.prima_neta,
    iva: premium.iva,
    prima_total: premium.prima_total,
  };
}

function calculatePremium({
  insuredValue,
  rate,
  validityDays,
  ivaPercentage,
}: {
  insuredValue: number | null;
  rate: number | null;
  validityDays: number | null;
  ivaPercentage: number;
}) {
  if (insuredValue === null || rate === null || validityDays === null) {
    return {
      prima_neta: null,
      iva: null,
      prima_total: null,
    };
  }

  const primaNeta = roundMoney((insuredValue * rate * validityDays) / 365);
  const iva = roundMoney(primaNeta * ivaPercentage);

  return {
    prima_neta: primaNeta,
    iva,
    prima_total: roundMoney(primaNeta + iva),
  };
}

function inferIvaPercentage(coverage: QuoteSnapshotCoverage) {
  if (
    coverage.prima_neta !== null &&
    coverage.prima_neta > 0 &&
    coverage.iva !== null
  ) {
    return coverage.iva / coverage.prima_neta;
  }

  return 0.19;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
