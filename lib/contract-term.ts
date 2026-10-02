import { findAdditionalPeriod, foldSpanish, type PeriodUnit } from "@/lib/spanish-dates";

const TERM_MARKER = /;?\s*plazo calculable:[\s\S]*$/i;
const CONTRACTUAL_TERM_LABEL =
  /plazo de ejecucion|plazo contractual|duracion del contrato|duracion|termino de ejecucion|vigencia del contrato/g;
const PAYMENT_WORDS =
  /\b(pago|pagos|pagar|pagara|pagadero|pagaderos|factura|facturas|facturacion|cobro|desembolso)\b/;
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

// El marcador "plazo calculable" (escrito al guardar) prevalece sobre el texto original del contrato;
// luego el periodo ligado a lenguaje contractual, y por último cualquier periodo fuera de frases de pago.
export function parseContractTerm(text: string | null | undefined): ContractTerm | null {
  if (!text) {
    return null;
  }

  const marker = text.match(TERM_MARKER);
  const found =
    (marker ? findAdditionalPeriod(marker[0], { preferSignal: false }) : null) ??
    findContractualPeriod(text) ??
    findUnpaidPeriod(text);

  return found ? { cantidad: found.cantidad, unidad: found.unidad } : null;
}

function findContractualPeriod(text: string) {
  const folded = foldSpanish(text);

  for (const match of folded.matchAll(CONTRACTUAL_TERM_LABEL)) {
    const rest = folded.slice((match.index ?? 0) + match[0].length);
    const sentenceEnd = rest.search(/[.;](?:\s|$)/);
    const clause = sentenceEnd >= 0 ? rest.slice(0, sentenceEnd) : rest;
    const found = findAdditionalPeriod(clause, { preferSignal: false });

    if (found) {
      return found;
    }
  }

  return null;
}

function findUnpaidPeriod(text: string) {
  const clauses = text
    .split(/[.;](?:\s+|$)/)
    .filter((clause) => !PAYMENT_WORDS.test(foldSpanish(clause)));

  return clauses.length > 0
    ? findAdditionalPeriod(clauses.join(". "), { preferSignal: false })
    : null;
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
