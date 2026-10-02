// Anchos AFM de Helvetica y Helvetica-Bold (fuentes estándar PDF, codificación WinAnsi), en milésimas de em.
const REGULAR_ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667,
  778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556,
  556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
  334, 260, 334, 584,
];

const BOLD_ASCII = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  333, 333, 584, 584, 584, 611, 975,
  722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667,
  778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  333, 278, 333, 584, 556, 333,
  556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611,
  611, 389, 556, 333, 611, 556, 778, 556, 556, 500,
  389, 280, 389, 584,
];

const REGULAR_LATIN1 = [
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333,
  400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
];

const BOLD_LATIN1 = [
  278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333,
  400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278,
  611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556,
];

// Posiciones 0x80-0x9F de WinAnsi: [regular, negrita].
const WIN_ANSI_SPECIALS: Record<string, { code: number; widths: [number, number] }> = {
  "€": { code: 0x80, widths: [556, 556] },
  "‚": { code: 0x82, widths: [222, 278] },
  "ƒ": { code: 0x83, widths: [556, 556] },
  "„": { code: 0x84, widths: [333, 500] },
  "…": { code: 0x85, widths: [1000, 1000] },
  "†": { code: 0x86, widths: [556, 556] },
  "‡": { code: 0x87, widths: [556, 556] },
  "ˆ": { code: 0x88, widths: [333, 333] },
  "‰": { code: 0x89, widths: [1000, 1000] },
  "Š": { code: 0x8a, widths: [667, 667] },
  "‹": { code: 0x8b, widths: [333, 333] },
  "Œ": { code: 0x8c, widths: [1000, 1000] },
  "Ž": { code: 0x8e, widths: [611, 611] },
  "‘": { code: 0x91, widths: [222, 278] },
  "’": { code: 0x92, widths: [222, 278] },
  "“": { code: 0x93, widths: [333, 500] },
  "”": { code: 0x94, widths: [333, 500] },
  "•": { code: 0x95, widths: [350, 350] },
  "–": { code: 0x96, widths: [556, 556] },
  "—": { code: 0x97, widths: [1000, 1000] },
  "˜": { code: 0x98, widths: [333, 333] },
  "™": { code: 0x99, widths: [1000, 1000] },
  "š": { code: 0x9a, widths: [500, 556] },
  "›": { code: 0x9b, widths: [333, 333] },
  "œ": { code: 0x9c, widths: [944, 944] },
  "ž": { code: 0x9e, widths: [500, 500] },
  "Ÿ": { code: 0x9f, widths: [667, 667] },
};

const DEFAULT_GLYPH_WIDTH = 556;

export function normalizePdfText(value: string) {
  return value
    .normalize("NFC")
    .replace(/\u00a0/g, " ")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/•/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function winAnsiCode(char: string) {
  const special = WIN_ANSI_SPECIALS[char];

  if (special) {
    return special.code;
  }

  const code = char.charCodeAt(0);

  if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) {
    return code;
  }

  return "?".charCodeAt(0);
}

export function toPdfText(value: string) {
  const bytes = Array.from(normalizePdfText(value)).map((char) =>
    winAnsiCode(char),
  );

  return `<${bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")}>`;
}

function glyphWidth(char: string, bold: boolean) {
  const special = WIN_ANSI_SPECIALS[char];

  if (special) {
    return special.widths[bold ? 1 : 0];
  }

  const code = winAnsiCode(char);
  const ascii = bold ? BOLD_ASCII : REGULAR_ASCII;
  const latin1 = bold ? BOLD_LATIN1 : REGULAR_LATIN1;

  if (code >= 0x20 && code <= 0x7e) {
    return ascii[code - 0x20] ?? DEFAULT_GLYPH_WIDTH;
  }

  if (code >= 0xa0 && code <= 0xff) {
    return latin1[code - 0xa0] ?? DEFAULT_GLYPH_WIDTH;
  }

  return DEFAULT_GLYPH_WIDTH;
}

// Ancho real en puntos de un texto ya normalizado, tal como lo dibuja el PDF.
export function measureText(text: string, fontSize: number, bold = false) {
  const total = Array.from(text).reduce(
    (sum, char) => sum + glyphWidth(char, bold),
    0,
  );

  return (total * fontSize) / 1000;
}

function isNumericToken(word: string) {
  return /^[$€]?[\d.,]+%?$/.test(word);
}

function splitLongWord(
  word: string,
  maxWidth: number,
  fontSize: number,
  bold: boolean,
) {
  if (measureText(word, fontSize, bold) <= maxWidth || isNumericToken(word)) {
    return [word];
  }

  const chunks: string[] = [];
  let current = "";

  Array.from(word).forEach((char) => {
    const next = `${current}${char}`;

    if (current && measureText(next, fontSize, bold) > maxWidth) {
      chunks.push(current);
      current = char;
      return;
    }

    current = next;
  });

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

// Las cifras nunca se parten: si no caben, la celda reduce la fuente (ver fitFontSize).
export function wrapText(
  value: string,
  maxWidth: number,
  fontSize: number,
  bold = false,
) {
  const words = normalizePdfText(value).split(" ");
  const lines: string[] = [];
  let current = "";

  words.forEach((word) => {
    splitLongWord(word, maxWidth, fontSize, bold).forEach((chunk) => {
      const next = current ? `${current} ${chunk}` : chunk;

      if (measureText(next, fontSize, bold) <= maxWidth) {
        current = next;
        return;
      }

      if (current) {
        lines.push(current);
      }

      current = chunk;
    });
  });

  if (current) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [""];
}

// Tamaño de fuente que hace caber una sola línea en el ancho disponible.
export function fitFontSize(
  text: string,
  maxWidth: number,
  fontSize: number,
  bold = false,
  minFontSize = 4.5,
) {
  const width = measureText(normalizePdfText(text), fontSize, bold);

  if (width <= maxWidth || width === 0) {
    return fontSize;
  }

  return Math.max(minFontSize, (fontSize * maxWidth) / width);
}
