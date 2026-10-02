import { measureText } from "../lib/pdf/text.ts";

// Lee los content streams que genera lib/*-pdf.ts (texto sin comprimir) y devuelve textos y celdas por página.
export function inspectPdf(pdfBuffer) {
  const raw = Buffer.from(pdfBuffer).toString("latin1");
  const streams = [...raw.matchAll(/stream\n([\s\S]*?)\nendstream/g)]
    .map((match) => match[1])
    .filter((content) => content.includes(" Tf "));

  return streams.map((content) => {
    const texts = [...content.matchAll(
      /\/(F1|F2) ([\d.]+) Tf 1 0 0 1 ([\d.\-]+) ([\d.\-]+) Tm <([0-9a-f]*)> Tj/g,
    )].map((match) => {
      const bold = match[1] === "F2";
      const fontSize = Number(match[2]);
      const text = Buffer.from(match[5], "hex").toString("latin1");

      return {
        bold,
        fontSize,
        x: Number(match[3]),
        y: Number(match[4]),
        text,
        width: measureText(text, fontSize, bold),
      };
    });
    const rects = [...content.matchAll(
      /0\.86 0\.86 0\.86 RG [\d.]+ w ([\d.\-]+) ([\d.\-]+) ([\d.\-]+) ([\d.\-]+) re S/g,
    )].map((match) => ({
      x: Number(match[1]),
      y: Number(match[2]),
      w: Number(match[3]),
      h: Number(match[4]),
    }));

    return { texts, rects };
  });
}

// Devuelve los textos que se salen de su celda o del margen derecho de la página.
export function findOverflows(pages, { pageWidth, marginX }) {
  const problems = [];
  let checked = 0;

  pages.forEach((page, pageIndex) => {
    page.texts.forEach((item) => {
      const rect = page.rects.find(
        (candidate) =>
          item.x >= candidate.x - 0.01 &&
          item.x <= candidate.x + candidate.w &&
          item.y >= candidate.y &&
          item.y <= candidate.y + candidate.h,
      );

      if (item.x + item.width > pageWidth - marginX + 0.01) {
        problems.push({ pageIndex, reason: "margen", item });
      }

      if (!rect) {
        return;
      }

      checked += 1;

      if (item.x + item.width > rect.x + rect.w - 3.99) {
        problems.push({ pageIndex, reason: "derecha", item, rect });
      }

      if (item.x < rect.x + 3.99 - 0.01) {
        problems.push({ pageIndex, reason: "izquierda", item, rect });
      }

      if (item.y < rect.y || item.y + item.fontSize * 0.75 > rect.y + rect.h) {
        problems.push({ pageIndex, reason: "vertical", item, rect });
      }
    });
  });

  return { problems, checked };
}
