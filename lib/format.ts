import type { ContractState } from "@/lib/constants";
import { formatDateOnly } from "@/lib/date-only";
import { normalizeDate } from "@/lib/normalizers";

export function formatCurrency(value: number | null | undefined, currency = "COP") {
  void currency;

  if (value === null || typeof value === "undefined") {
    return "Sin valor";
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "Sin valor";
  }

  const amount = new Intl.NumberFormat("es-CO", {
    style: "decimal",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(numericValue);

  return `$ ${amount}`;
}

export function parseLocalizedNumber(value: string | number | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const clean = value
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^0-9.,-]/g, "");

  if (!clean || clean === "-" || clean === "," || clean === ".") {
    return null;
  }

  const lastComma = clean.lastIndexOf(",");
  const lastDot = clean.lastIndexOf(".");
  let normalized = clean;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const groupingSeparator = decimalSeparator === "," ? "." : ",";
    const groupingPattern = groupingSeparator === "." ? /\./g : /,/g;
    normalized = clean
      .replace(groupingPattern, "")
      .replace(decimalSeparator, ".");
  } else if (lastComma >= 0) {
    normalized = clean.replace(/\./g, "").replace(",", ".");
  } else if ((clean.match(/\./g) ?? []).length > 1) {
    normalized = clean.replace(/\./g, "");
  } else if (lastDot >= 0) {
    const decimals = clean.length - lastDot - 1;
    const integerPart = clean.slice(0, lastDot).replace("-", "");
    normalized =
      decimals === 3 && integerPart.length >= 1 && integerPart.length <= 3
        ? clean.replace(/\./g, "")
        : clean;
  }

  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
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
