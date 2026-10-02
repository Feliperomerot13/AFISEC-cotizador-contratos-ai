export type DateOnlyParts = {
  year: number;
  month: number;
  day: number;
};

export function parseDateOnly(value: string | null | undefined): DateOnlyParts | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

export function addDaysToDateOnly(value: string, days: number): string | null {
  const parts = parseDateOnly(value);

  if (!parts || !Number.isFinite(days)) {
    return null;
  }

  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + Math.trunc(days));

  return dateOnlyToIso(date);
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Suma meses de calendario; si el día no existe en el mes destino, usa el último día del mes.
export function addMonthsToDateOnly(value: string, months: number): string | null {
  const parts = parseDateOnly(value);

  if (!parts || !Number.isFinite(months)) {
    return null;
  }

  const monthIndex = parts.year * 12 + (parts.month - 1) + Math.trunc(months);
  const year = Math.floor(monthIndex / 12);
  const month = (monthIndex % 12 + 12) % 12 + 1;
  const day = Math.min(parts.day, daysInMonth(year, month));

  return dateOnlyToIso(new Date(Date.UTC(year, month - 1, day)));
}

export function addPeriodToDateOnly(
  value: string,
  quantity: number,
  unit: "dias" | "meses" | "anios",
): string | null {
  if (unit === "dias") {
    return addDaysToDateOnly(value, quantity);
  }

  return addMonthsToDateOnly(value, unit === "anios" ? quantity * 12 : quantity);
}

export function diffDaysDateOnly(startValue: string, endValue: string): number | null {
  const start = parseDateOnly(startValue);
  const end = parseDateOnly(endValue);

  if (!start || !end) {
    return null;
  }

  const startTime = Date.UTC(start.year, start.month - 1, start.day);
  const endTime = Date.UTC(end.year, end.month - 1, end.day);

  return Math.round((endTime - startTime) / (1000 * 60 * 60 * 24));
}

export function formatDateOnly(value: string, locale = "es-CO"): string {
  const parts = parseDateOnly(value);

  if (!parts) {
    return "No registrada";
  }

  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)));
}

function dateOnlyToIso(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
