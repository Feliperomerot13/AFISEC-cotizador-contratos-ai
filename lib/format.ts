import type { ContractState } from "@/lib/constants";
import { formatDateOnly } from "@/lib/date-only";
import { normalizeDate } from "@/lib/normalizers";

export function formatCurrency(value: number | null | undefined, currency = "COP") {
  void currency;

  if (value === null || typeof value === "undefined") {
    return "Sin valor";
  }

  const roundedValue = Math.round(Number(value));

  if (!Number.isFinite(roundedValue)) {
    return "Sin valor";
  }

  return new Intl.NumberFormat("es-CO", {
    style: "decimal",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(roundedValue);
}

export function formatDate(value: unknown) {
  const normalizedDate = normalizeDate(value);

  if (!normalizedDate) {
    return "No registrada";
  }

  return formatDateOnly(normalizedDate);
}

export function stateLabel(state: string) {
  const labels: Record<ContractState, string> = {
    cargado: "Cargado",
    procesando: "Procesando",
    procesado_ia: "Procesado IA",
    pendiente_validacion: "Pendiente",
    validado: "Validado",
    error: "Error",
  };

  return labels[state as ContractState] ?? state;
}

export function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function percentFromDecimal(value: number | null | undefined) {
  if (value === null || typeof value === "undefined") {
    return "";
  }

  return String(Number((value * 100).toFixed(4)));
}
