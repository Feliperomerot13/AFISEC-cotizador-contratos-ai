const EMPTY_MARKERS = new Set([
  "",
  "n/a",
  "na",
  "no aplica",
  "no especificado",
  "no especificada",
  "no registra",
  "sin especificar",
  "sin dato",
  "null",
  "undefined",
]);

export function getExtractionValue(value: unknown): unknown {
  if (value === null || typeof value === "undefined") {
    return null;
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;

    if ("valor" in record) {
      return record.valor;
    }

    if ("value" in record) {
      return record.value;
    }
  }

  return value;
}

export function normalizeText(
  value: unknown,
  fallback: string | null = null,
): string | null {
  const extracted = getExtractionValue(value);

  if (extracted === null || typeof extracted === "undefined") {
    return fallback;
  }

  if (typeof extracted === "object") {
    return fallback;
  }

  const text = String(extracted).replace(/\s+/g, " ").trim();

  if (isEmptyMarker(text)) {
    return fallback;
  }

  return text;
}

export function normalizeBoolean(value: unknown, fallback = false): boolean {
  const extracted = getExtractionValue(value);

  if (typeof extracted === "boolean") {
    return extracted;
  }

  if (typeof extracted === "number" && Number.isFinite(extracted)) {
    return extracted !== 0;
  }

  if (typeof extracted === "string") {
    const normalized = normalizeForMatch(extracted);

    if (["true", "si", "sí", "yes", "1", "verdadero"].includes(normalized)) {
      return true;
    }

    if (["false", "no", "0", "falso"].includes(normalized)) {
      return false;
    }
  }

  return fallback;
}

export function normalizeCurrency(value: unknown): string {
  const directValue = getExtractionValue(value);
  const nestedCurrency =
    directValue && typeof directValue === "object" && !Array.isArray(directValue)
      ? (directValue as Record<string, unknown>).moneda
      : null;
  const text = normalizeForMatch(nestedCurrency ?? directValue);

  if (
    text.includes("usd") ||
    text.includes("dolar") ||
    text.includes("dólar") ||
    text.includes("dolares") ||
    text.includes("dólares") ||
    text.includes("dollar") ||
    text.includes("dollars") ||
    text.includes("us$")
  ) {
    return "USD";
  }

  if (text.includes("eur") || text.includes("euro")) {
    return "EUR";
  }

  if (
    text === "$" ||
    text.includes("cop") ||
    text.includes("peso") ||
    text.includes("colomb") ||
    text.includes("moneda legal") ||
    text.includes("m/cte") ||
    text.includes("mcte")
  ) {
    return "COP";
  }

  return "COP";
}

export function normalizeNumber(value: unknown): number | null {
  const extracted = getExtractionValue(value);

  if (typeof extracted === "number") {
    return Number.isFinite(extracted) ? extracted : null;
  }

  if (typeof extracted !== "string") {
    return null;
  }

  const text = extracted.trim();

  if (isEmptyMarker(text)) {
    return null;
  }

  const match = text.replace(/[^\d,.\-]+/g, " ").match(/-?\d[\d.,]*/);

  if (!match) {
    return null;
  }

  const parsed = parseNumberFragment(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeInteger(value: unknown): number | null {
  const number = normalizeNumber(value);
  return number === null ? null : Math.trunc(number);
}

export function normalizeDate(value: unknown): string | null {
  const extracted = getExtractionValue(value);

  if (extracted instanceof Date) {
    return toValidDateString(
      extracted.getUTCFullYear(),
      extracted.getUTCMonth() + 1,
      extracted.getUTCDate(),
    );
  }

  if (typeof extracted !== "string") {
    return null;
  }

  const text = extracted.trim();

  if (isEmptyMarker(text)) {
    return null;
  }

  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (isoDate) {
    return toValidDateString(
      Number(isoDate[1]),
      Number(isoDate[2]),
      Number(isoDate[3]),
    );
  }

  const slashDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (slashDate) {
    return toValidDateString(
      Number(slashDate[3]),
      Number(slashDate[2]),
      Number(slashDate[1]),
    );
  }

  return null;
}

export function normalizeEnum<const T extends readonly string[]>(
  value: unknown,
  allowedValues: T,
  fallback: T[number] | null,
): T[number] | null {
  const text = normalizeText(value, null);

  if (text === null) {
    return fallback;
  }

  const normalizedText = normalizeForMatch(text);
  const match = allowedValues.find(
    (allowed) => normalizeForMatch(allowed) === normalizedText,
  );

  return match ?? fallback;
}

function parseNumberFragment(fragment: string) {
  const hasComma = fragment.includes(",");
  const hasDot = fragment.includes(".");

  if (hasComma && hasDot) {
    const lastComma = fragment.lastIndexOf(",");
    const lastDot = fragment.lastIndexOf(".");
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const groupSeparator = decimalSeparator === "," ? "." : ",";

    return Number(
      fragment
        .replaceAll(groupSeparator, "")
        .replace(decimalSeparator, "."),
    );
  }

  if (hasDot) {
    return parseSingleSeparatorNumber(fragment, ".");
  }

  if (hasComma) {
    return parseSingleSeparatorNumber(fragment, ",");
  }

  return Number(fragment);
}

function parseSingleSeparatorNumber(fragment: string, separator: "," | ".") {
  const parts = fragment.split(separator);

  if (parts.length > 2) {
    return Number(parts.join(""));
  }

  const [integerPart, decimalPart] = parts;

  if (!decimalPart) {
    return Number(integerPart);
  }

  if (decimalPart.length === 3 && integerPart.length <= 3) {
    return Number(parts.join(""));
  }

  return Number(`${integerPart}.${decimalPart}`);
}

function toValidDateString(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function isEmptyMarker(value: string) {
  return EMPTY_MARKERS.has(normalizeForMatch(value));
}

function normalizeForMatch(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
