// Lectura determinista de periodos y fechas escritos en español. Funciones puras, sin dependencias.

export type PeriodUnit = "dias" | "meses" | "anios";

export const PERIOD_UNITS: readonly PeriodUnit[] = ["dias", "meses", "anios"];

export type ParsedPeriod = {
  cantidad: number;
  unidad: PeriodUnit;
  // "días hábiles": el sistema solo calcula días calendario y debe marcarlo para revisión.
  habiles: boolean;
  fragmento: string;
};

export function normalizePeriodUnit(value: unknown): PeriodUnit | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = foldSpanish(value);

  if (/^(dia|dias|d)$/.test(text)) {
    return "dias";
  }

  if (/^(mes|meses|m)$/.test(text)) {
    return "meses";
  }

  if (/^(ano|anos|anio|anios|a)$/.test(text)) {
    return "anios";
  }

  return null;
}

export function foldSpanish(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const UNITS_WORDS: Record<string, number> = {
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiun: 21,
  veintiuno: 21,
  veintiuna: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
};

const TENS_WORDS: Record<string, number> = {
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
};

const HUNDREDS_WORDS: Record<string, number> = {
  cien: 100,
  ciento: 100,
  doscientos: 200,
  doscientas: 200,
  trescientos: 300,
  trescientas: 300,
  cuatrocientos: 400,
  cuatrocientas: 400,
  quinientos: 500,
  quinientas: 500,
  seiscientos: 600,
  seiscientas: 600,
  setecientos: 700,
  setecientas: 700,
  ochocientos: 800,
  ochocientas: 800,
  novecientos: 900,
  novecientas: 900,
};

const NUMBER_WORDS = Object.keys({
  ...UNITS_WORDS,
  ...TENS_WORDS,
  ...HUNDREDS_WORDS,
}).sort((left, right) => right.length - left.length);
const NUMBER_WORD_PATTERN = NUMBER_WORDS.join("|");

// Convierte "treinta y cinco", "ciento veinte" o "dos" (0-999) a número.
export function parseSpanishNumberWords(value: string): number | null {
  const tokens = foldSpanish(value)
    .split(" ")
    .filter((token) => token && token !== "y");

  if (tokens.length === 0) {
    return null;
  }

  let total = 0;

  for (const token of tokens) {
    const amount =
      HUNDREDS_WORDS[token] ?? TENS_WORDS[token] ?? UNITS_WORDS[token];

    if (amount === undefined) {
      return null;
    }

    total += amount;
  }

  return total;
}

const PERIOD_PATTERN = new RegExp(
  `(?:\\b((?:(?:${NUMBER_WORD_PATTERN})(?:\\s+y)?\\s+)*(?:${NUMBER_WORD_PATTERN}))\\s*)?(?:\\(\\s*(\\d+)\\s*\\)\\s*|\\b(\\d+)\\s*)?(dias?|meses|mes|anos?)\\b`,
  "g",
);

type PeriodCandidate = ParsedPeriod & {
  index: number;
  signal: boolean;
  paymentContext: boolean;
};

function unitFromToken(token: string): PeriodUnit {
  if (token.startsWith("ano")) {
    return "anios";
  }

  return token.startsWith("mes") ? "meses" : "dias";
}

// Busca el periodo adicional de una cláusula: prefiere el que va seguido de "más"/"adicional"
// y descarta los plazos de pago cuando hay otra opción.
export function findAdditionalPeriod(
  text: string | null | undefined,
  options: { preferSignal?: boolean } = {},
): ParsedPeriod | null {
  const preferSignal = options.preferSignal ?? true;

  if (!text) {
    return null;
  }

  const normalized = foldSpanish(text);
  const candidates: PeriodCandidate[] = [];

  for (const match of normalized.matchAll(PERIOD_PATTERN)) {
    const wordPart = match[1];
    const parenthesized = match[2];
    const digits = match[3];
    const quantity =
      parenthesized !== undefined
        ? Number(parenthesized)
        : digits !== undefined
          ? Number(digits)
          : wordPart
            ? parseSpanishNumberWords(wordPart)
            : null;

    if (quantity === null || !Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }

    const index = match.index ?? 0;
    const end = index + match[0].length;
    const after = normalized.slice(end, end + 24);
    const before = normalized.slice(Math.max(0, index - 40), index);

    candidates.push({
      cantidad: quantity,
      unidad: unitFromToken(match[4]),
      habiles: /^\s*habiles?\b/.test(after),
      fragmento: normalized.slice(Math.max(0, index - 20), end + 20),
      index,
      signal: /^\W*(mas|adicional|adicionales|posteriores|siguientes)\b/.test(after) ||
        /(\+|\bmas)\s*$/.test(before),
      paymentContext: /\b(pago|pagos|pagar|pagara|factura|facturas|facturacion)\b/.test(before),
    });
  }

  const pool = candidates.some((candidate) => !candidate.paymentContext)
    ? candidates.filter((candidate) => !candidate.paymentContext)
    : candidates;
  const chosen =
    (preferSignal ? pool.find((candidate) => candidate.signal) : undefined) ??
    pool[0];

  if (!chosen) {
    return null;
  }

  return {
    cantidad: chosen.cantidad,
    unidad: chosen.unidad,
    habiles: chosen.habiles,
    fragmento: chosen.fragmento,
  };
}

const MONTHS: Record<string, number> = {
  enero: 1, ene: 1,
  febrero: 2, feb: 2,
  marzo: 3, mar: 3,
  abril: 4, abr: 4,
  mayo: 5, may: 5,
  junio: 6, jun: 6,
  julio: 7, jul: 7,
  agosto: 8, ago: 8,
  septiembre: 9, setiembre: 9, sep: 9, sept: 9, set: 9,
  octubre: 10, oct: 10,
  noviembre: 11, nov: 11,
  diciembre: 12, dic: 12,
};

const MONTH_PATTERN = Object.keys(MONTHS)
  .sort((left, right) => right.length - left.length)
  .join("|");
const DAY_PATTERN = `(?:(${NUMBER_WORD_PATTERN})\\s*\\(\\s*(\\d{1,2})\\s*\\)|(\\d{1,2})\\s*(?:°|º|o\\b)?|(primero|primera))`;
const YEAR_PATTERN = `(\\d{4}|dos mil(?:\\s+(?:y\\s+)?(?:${NUMBER_WORD_PATTERN})(?:\\s+y\\s+(?:${NUMBER_WORD_PATTERN}))?)?)(?:\\s*\\(\\s*\\d{4}\\s*\\))?`;
const WRITTEN_DATE = new RegExp(
  `\\b${DAY_PATTERN}\\s*(?:dias\\s+)?(?:de|del)\\s+(?:mes\\s+de\\s+)?(${MONTH_PATTERN})\\b\\.?\\s*,?\\s*(?:de\\s+|del\\s+)?${YEAR_PATTERN}`,
  "g",
);
const NUMERIC_DATE = /\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})\b/g;
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

function toValidIsoDate(year: number, month: number, day: number) {
  if (year < 1900 || year > 2200) {
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

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseYearToken(token: string) {
  if (/^\d{4}$/.test(token)) {
    return Number(token);
  }

  const rest = token.replace(/^dos mil/, "").trim();

  return 2000 + (rest ? (parseSpanishNumberWords(rest) ?? 0) : 0);
}

// Primera fecha de un texto en español: "lunes 2 de marzo del 2026", "dos (2) de marzo de dos mil veintiséis",
// "02-03-2026", "2/3/26" (día/mes/año) o ISO. Devuelve YYYY-MM-DD o null.
export function parseSpanishDate(text: string | null | undefined): string | null {
  if (!text) {
    return null;
  }

  const normalized = foldSpanish(text);
  const found: Array<{ index: number; date: string }> = [];

  for (const match of normalized.matchAll(WRITTEN_DATE)) {
    const day = match[2]
      ? Number(match[2])
      : match[3]
        ? Number(match[3])
        : match[4]
          ? 1
          : (parseSpanishNumberWords(match[1] ?? "") ?? 0);
    const date = toValidIsoDate(parseYearToken(match[6]), MONTHS[match[5]], day);

    if (date) {
      found.push({ index: match.index ?? 0, date });
    }
  }

  for (const match of normalized.matchAll(NUMERIC_DATE)) {
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    const date = toValidIsoDate(year, Number(match[2]), Number(match[1]));

    if (date) {
      found.push({ index: match.index ?? 0, date });
    }
  }

  for (const match of normalized.matchAll(ISO_DATE)) {
    const date = toValidIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));

    if (date) {
      found.push({ index: match.index ?? 0, date });
    }
  }

  found.sort((left, right) => left.index - right.index);

  return found[0]?.date ?? null;
}
