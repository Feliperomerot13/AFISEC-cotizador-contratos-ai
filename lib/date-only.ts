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
