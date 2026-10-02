import { findAdditionalPeriod, type PeriodUnit } from "@/lib/spanish-dates";

const TERM_MARKER = /;?\s*plazo calculable:[\s\S]*$/i;
const AUTO_TERM = /^\d+ (?:día|días|mes|meses|año|años)$/;

export type ContractTerm = { cantidad: number; unidad: PeriodUnit };

const UNIT_LABELS: Record<PeriodUnit, [string, string]> = {
  dias: ["día", "días"],
  meses: ["mes", "meses"],
  anios: ["año", "años"],
};

export function contractTermUnitLabel(unit: PeriodUnit, quantity: number) {
  return UNIT_LABELS[unit][quantity === 1 ? 0 : 1];
}

// El marcador "plazo calculable" (escrito al guardar) prevalece sobre el texto original del contrato.
export function parseContractTerm(text: string | null | undefined): ContractTerm | null {
  if (!text) {
    return null;
  }

  const marker = text.match(TERM_MARKER);
  const found =
    (marker ? findAdditionalPeriod(marker[0], { preferSignal: false }) : null) ??
    findAdditionalPeriod(text, { preferSignal: false });

  return found ? { cantidad: found.cantidad, unidad: found.unidad } : null;
}

// Conserva el texto original y agrega "plazo calculable: N unidad" solo si difiere de lo que se lee hoy.
export function upsertContractTermText(
  current: string,
  quantity: number | null,
  unit: PeriodUnit,
) {
  if (quantity === null || !Number.isInteger(quantity) || quantity <= 0) {
    return current;
  }

  const parsed = parseContractTerm(current);

  if (parsed && parsed.cantidad === quantity && parsed.unidad === unit) {
    return current;
  }

  const base = current.replace(TERM_MARKER, "").trim();
  const term = `${quantity} ${contractTermUnitLabel(unit, quantity)}`;

  // Un texto que solo contiene "N unidad" fue generado aquí; se reemplaza en vez de acumular marcadores.
  if (!base || AUTO_TERM.test(base)) {
    return term;
  }

  return `${base}; plazo calculable: ${term}`;
}
