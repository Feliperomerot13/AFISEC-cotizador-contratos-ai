import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import {
  formatCoverageName,
  getQuoteCommercialIssues,
  type QuoteSnapshot,
  type QuoteSnapshotSubcoverage,
} from "@/lib/quotes";

type QuotePdfInput = {
  quoteNumber: string;
  version: number;
  snapshot: QuoteSnapshot;
};

type PdfPage = {
  commands: string[];
  y: number;
};

type PdfImage = {
  width: number;
  height: number;
  data: Buffer;
};

type PdfObjectBody = string | Buffer | Array<string | Buffer>;

type PdfTableCell = {
  text: string;
  width: number;
  align?: "left" | "right" | "center";
  bold?: boolean;
  fill?: string;
  color?: string;
};

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_X = 36;
const TOP_Y = 748;
const BOTTOM_Y = 58;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const AFISEC_PRIMARY = "0.824 0.357 0.188";
const AFISEC_GRAY = "0.478 0.478 0.478";
const TABLE_BORDER = "0.86 0.86 0.86";
const TABLE_HEADER = "0.96 0.94 0.93";
const AFISEC_LOGO_PATH = join(
  process.cwd(),
  "public",
  "brand",
  "Logo_Color_Afisec_cuadrado.png",
);

export function generateQuotePdf({
  quoteNumber,
  version,
  snapshot,
}: QuotePdfInput): Uint8Array {
  const commercialIssues = getQuoteCommercialIssues(snapshot);

  if (commercialIssues.length > 0) {
    throw new Error(
      [
        "No se puede generar el PDF comercial con amparos incompletos.",
        ...commercialIssues,
      ].join(" "),
    );
  }

  const pages: PdfPage[] = [];
  const logo = loadAfisecLogo();
  const page = () => pages[pages.length - 1];

  function newPage() {
    pages.push({ commands: [], y: TOP_Y });
  }

  function ensureSpace(height: number) {
    if (!page() || page().y - height < BOTTOM_Y) {
      newPage();
    }
  }

  function addHeader() {
    ensureSpace(96);
    const current = page();

    current.commands.push(
      `1 1 1 rg ${MARGIN_X} ${current.y - 76} ${CONTENT_WIDTH} 86 re f`,
    );

    if (logo) {
      current.commands.push(
        `q 44 0 0 52 ${MARGIN_X} ${current.y - 52} cm /Logo Do Q`,
      );
    }

    current.commands.push(
      `${AFISEC_PRIMARY} rg BT /F2 16 Tf 1 0 0 1 ${MARGIN_X + 58} ${current.y - 16} Tm ${toPdfText("Cotización de garantías contractuales")} Tj ET`,
      `${AFISEC_GRAY} rg BT /F1 9 Tf 1 0 0 1 ${MARGIN_X + 58} ${current.y - 31} Tm ${toPdfText("AFISEC")} Tj ET`,
    );

    addTableRows(
      [
        [
          { text: "Cotización", width: 72, bold: true, fill: TABLE_HEADER },
          { text: quoteNumber, width: 112 },
        ],
        [
          { text: "Versión", width: 72, bold: true, fill: TABLE_HEADER },
          { text: String(version), width: 112 },
        ],
        [
          { text: "Fecha", width: 72, bold: true, fill: TABLE_HEADER },
          { text: formatDate(snapshot.generado_en), width: 112 },
        ],
      ],
      {
        x: PAGE_WIDTH - MARGIN_X - 184,
        y: current.y - 6,
        fontSize: 7.5,
        lineHeight: 9,
        minHeight: 16,
      },
    );

    current.commands.push(
      `${AFISEC_PRIMARY} RG 1.5 w ${MARGIN_X} ${current.y - 72} m ${PAGE_WIDTH - MARGIN_X} ${current.y - 72} l S`,
    );
    current.y -= 88;
  }

  function addSectionTitle(title: string) {
    ensureSpace(24);
    page().commands.push(
      `${AFISEC_PRIMARY} rg BT /F2 11 Tf 1 0 0 1 ${MARGIN_X} ${page().y} Tm ${toPdfText(title)} Tj ET`,
    );
    page().y -= 14;
  }

  function addGeneralInfoTable() {
    addSectionTitle("Información general");
    addTableRows(
      [
        [
          { text: "Cliente", width: 72, bold: true, fill: TABLE_HEADER },
          { text: snapshot.cliente.nombre, width: 196 },
          { text: "NIT", width: 76, bold: true, fill: TABLE_HEADER },
          { text: snapshot.cliente.nit, width: 196 },
        ],
        [
          { text: "Ejecutiva", width: 72, bold: true, fill: TABLE_HEADER },
          { text: snapshot.cliente.ejecutivo, width: 196 },
          { text: "Contrato / orden", width: 76, bold: true, fill: TABLE_HEADER },
          { text: snapshot.contrato.numero_contrato ?? "Sin número", width: 196 },
        ],
        [
          { text: "Contratante", width: 72, bold: true, fill: TABLE_HEADER },
          { text: snapshot.contrato.contratante ?? "Sin dato", width: 196 },
          { text: "Contratista", width: 76, bold: true, fill: TABLE_HEADER },
          { text: snapshot.contrato.contratista ?? "Sin dato", width: 196 },
        ],
        [
          { text: "Valor base", width: 72, bold: true, fill: TABLE_HEADER },
          {
            text: formatMoney(
              snapshot.contrato.base_calculo_amparos ??
                snapshot.contrato.valor_contrato,
              snapshot.contrato.moneda,
            ),
            width: 196,
          },
          { text: "Base incluye IVA", width: 76, bold: true, fill: TABLE_HEADER },
          {
            text: getBaseIncludesIvaLabel(
              snapshot.contrato.base_calculo_incluye_iva,
            ),
            width: 196,
          },
        ],
        [
          { text: "Vigencia general", width: 72, bold: true, fill: TABLE_HEADER },
          {
            text: `${formatDate(snapshot.contrato.fecha_inicio)} a ${formatDate(snapshot.contrato.fecha_fin)}`,
            width: 468,
          },
        ],
        [
          { text: "Objeto resumido", width: 72, bold: true, fill: TABLE_HEADER },
          { text: snapshot.contrato.objeto ?? "Sin dato", width: 468 },
        ],
      ],
      {
        fontSize: 7.5,
        lineHeight: 9,
        minHeight: 18,
      },
    );
    page().y -= 12;
  }

  function addCoverageTable() {
    addSectionTitle("Amparos cotizados");

    const header: PdfTableCell[] = [
      { text: "Amparo", width: 150, bold: true, fill: TABLE_HEADER },
      {
        text: "Valor asegurado",
        width: 82,
        bold: true,
        fill: TABLE_HEADER,
      },
      { text: "Desde", width: 42, bold: true, fill: TABLE_HEADER },
      { text: "Hasta", width: 42, bold: true, fill: TABLE_HEADER },
      { text: "Días", width: 28, bold: true, fill: TABLE_HEADER, align: "right" },
      {
        text: "Prima neta",
        width: 70,
        bold: true,
        fill: TABLE_HEADER,
        align: "right",
      },
      { text: "IVA", width: 56, bold: true, fill: TABLE_HEADER, align: "right" },
      {
        text: "Prima total",
        width: 70,
        bold: true,
        fill: TABLE_HEADER,
        align: "right",
      },
    ];

    addTableRows([header], {
      fontSize: 7,
      lineHeight: 8.5,
      minHeight: 20,
    });

    if (snapshot.amparos.length === 0) {
      addTableRows(
        [[{ text: "No se registran amparos cotizados.", width: CONTENT_WIDTH }]],
        {
          fontSize: 7.5,
          lineHeight: 9,
          minHeight: 20,
        },
      );
      page().y -= 12;
      return;
    }

    snapshot.amparos.forEach((amparo) => {
      const includedSubcoverages = getIncludedSubcoverages(amparo.subamparos);
      const row: PdfTableCell[] = [
        { text: formatCoverageName(amparo.tipo_amparo), width: 150 },
        {
          text: formatMoney(amparo.valor_asegurado, snapshot.contrato.moneda),
          width: 82,
          align: "right",
        },
        { text: formatCompactDate(amparo.fecha_desde), width: 42 },
        { text: formatCompactDate(amparo.fecha_hasta), width: 42 },
        {
          text:
            amparo.dias_vigencia === null
              ? "Sin dato"
              : String(amparo.dias_vigencia),
          width: 28,
          align: "right",
        },
        {
          text: formatMoney(amparo.prima_neta, snapshot.contrato.moneda),
          width: 70,
          align: "right",
        },
        {
          text: formatMoney(amparo.iva, snapshot.contrato.moneda),
          width: 56,
          align: "right",
        },
        {
          text: formatMoney(amparo.prima_total, snapshot.contrato.moneda),
          width: 70,
          align: "right",
        },
      ];
      const rowHeight = getRowHeight(row, 6.4, 8.2, 24);

      if (page().y - rowHeight < BOTTOM_Y) {
        newPage();
        addTableRows([header], {
          fontSize: 7,
          lineHeight: 8.5,
          minHeight: 20,
        });
      }

      addTableRows([row], {
        fontSize: 6.4,
        lineHeight: 8.2,
        minHeight: 24,
      });

      if (
        isCivilLiabilityCoverage(amparo.tipo_amparo) &&
        includedSubcoverages.length > 0
      ) {
        addTableRows(
          [
            [
              {
                text: `Subamparos incluidos (informativos, sin prima individual): ${formatSubcoveragesForPdf(includedSubcoverages, snapshot.contrato.moneda)}. La prima corresponde únicamente a la línea principal RCE/PLO.`,
                width: CONTENT_WIDTH,
                fill: "0.985 0.985 0.985",
                color: AFISEC_GRAY,
              },
            ],
          ],
          {
            fontSize: 6.6,
            lineHeight: 8,
            minHeight: 20,
          },
        );
      }
    });

    page().y -= 12;
  }

  function addTotalsTable() {
    ensureSpace(92);
    addSectionTitle("Totales");
    addTableRows(
      [
        [
          { text: "Total prima neta", width: 135, bold: true, fill: TABLE_HEADER },
          {
            text: formatMoney(snapshot.totales.prima_neta, snapshot.contrato.moneda),
            width: 125,
            align: "right",
          },
        ],
        [
          { text: "Total IVA", width: 135, bold: true, fill: TABLE_HEADER },
          {
            text: formatMoney(snapshot.totales.iva, snapshot.contrato.moneda),
            width: 125,
            align: "right",
          },
        ],
        [
          { text: "Total cotización", width: 135, bold: true, fill: TABLE_HEADER },
          {
            text: formatMoney(snapshot.totales.prima_total, snapshot.contrato.moneda),
            width: 125,
            align: "right",
            bold: true,
            color: AFISEC_PRIMARY,
          },
        ],
      ],
      {
        x: PAGE_WIDTH - MARGIN_X - 260,
        fontSize: 8,
        lineHeight: 10,
        minHeight: 20,
      },
    );
    page().y -= 10;
  }

  function addCommercialNotes() {
    ensureSpace(48);
    addSectionTitle("Observaciones comerciales");
    addTableRows(
      snapshot.observaciones.map((observation) => [
        { text: formatCommercialObservation(observation), width: CONTENT_WIDTH },
      ]),
      {
        fontSize: 7.5,
        lineHeight: 9,
        minHeight: 18,
      },
    );
  }

  function addTableRows(
    rows: PdfTableCell[][],
    options: {
      x?: number;
      y?: number;
      fontSize: number;
      lineHeight: number;
      minHeight: number;
    },
  ) {
    let y = options.y ?? page().y;

    rows.forEach((row) => {
      const rowHeight = getRowHeight(
        row,
        options.fontSize,
        options.lineHeight,
        options.minHeight,
      );

      if (typeof options.y !== "number" && page().y - rowHeight < BOTTOM_Y) {
        newPage();
        y = page().y;
      }

      drawTableRow(row, {
        x: options.x ?? MARGIN_X,
        y,
        height: rowHeight,
        fontSize: options.fontSize,
        lineHeight: options.lineHeight,
      });

      y -= rowHeight;

      if (typeof options.y !== "number") {
        page().y -= rowHeight;
      }
    });
  }

  function drawTableRow(
    row: PdfTableCell[],
    options: {
      x: number;
      y: number;
      height: number;
      fontSize: number;
      lineHeight: number;
    },
  ) {
    let x = options.x;

    row.forEach((cell) => {
      const fill = cell.fill ?? "1 1 1";

      page().commands.push(
        `${fill} rg ${x} ${options.y - options.height} ${cell.width} ${options.height} re f`,
        `${TABLE_BORDER} RG 0.4 w ${x} ${options.y - options.height} ${cell.width} ${options.height} re S`,
      );

      x += cell.width;
    });

    x = options.x;

    row.forEach((cell) => {
      const lines = getCellLines(cell.text, cell.width, options.fontSize);
      const maxLines = Math.max(
        1,
        Math.floor((options.height - 6) / options.lineHeight),
      );

      lines.slice(0, maxLines).forEach((line, lineIndex) => {
        const textWidth = estimateTextWidth(line, options.fontSize);
        const textX = getAlignedTextX(
          x,
          cell.width,
          textWidth,
          cell.align ?? "left",
        );
        const textY =
          options.y - 6 - options.fontSize - lineIndex * options.lineHeight;

        page().commands.push(
          `${cell.color ?? "0 0 0"} rg BT /${cell.bold ? "F2" : "F1"} ${options.fontSize} Tf 1 0 0 1 ${textX} ${textY} Tm ${toPdfText(line)} Tj ET`,
        );
      });

      x += cell.width;
    });
  }

  function getRowHeight(
    row: PdfTableCell[],
    fontSize: number,
    lineHeight: number,
    minHeight: number,
  ) {
    const lineCount = Math.max(
      ...row.map((cell) => getCellLines(cell.text, cell.width, fontSize).length),
      1,
    );

    return Math.max(minHeight, 8 + lineCount * lineHeight);
  }

  function getCellLines(text: string, width: number, fontSize: number) {
    return wrapTextToWidth(text, Math.max(8, width - 8), fontSize);
  }

  function getAlignedTextX(
    x: number,
    width: number,
    textWidth: number,
    align: "left" | "right" | "center",
  ) {
    if (align === "right") {
      return x + width - textWidth - 4;
    }

    if (align === "center") {
      return x + (width - textWidth) / 2;
    }

    return x + 4;
  }

  function estimateTextWidth(text: string, fontSize: number) {
    return Array.from(text).reduce(
      (total, char) => total + getApproxCharWidth(char, fontSize),
      0,
    );
  }

  function getBaseIncludesIvaLabel(value: boolean | null) {
    if (value === null) {
      return "No determinado";
    }

    return value ? "Sí" : "No";
  }

  newPage();
  addHeader();
  addGeneralInfoTable();
  addCoverageTable();
  addTotalsTable();
  addCommercialNotes();

  pages.forEach((pdfPage, index) => {
    pdfPage.commands.push(
      `${AFISEC_GRAY} rg BT /F1 8 Tf 1 0 0 1 ${PAGE_WIDTH - 92} 30 Tm ${toPdfText(`Página ${index + 1} de ${pages.length}`)} Tj ET`,
    );
  });

  return buildPdf(
    pages.map((pdfPage) => pdfPage.commands.join("\n")),
    logo,
  );
}

function buildPdf(pageStreams: string[], logo: PdfImage | null) {
  const objectBodies: PdfObjectBody[] = [];
  const pageRefs: string[] = [];
  const logoObjectId = logo ? 5 : null;
  const firstPageObjectId = logo ? 6 : 5;

  objectBodies[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objectBodies[2] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objectBodies[3] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";

  if (logo && logoObjectId) {
    objectBodies[logoObjectId - 1] = [
      [
        "<< /Type /XObject",
        "/Subtype /Image",
        `/Width ${logo.width}`,
        `/Height ${logo.height}`,
        "/ColorSpace /DeviceRGB",
        "/BitsPerComponent 8",
        "/Filter /FlateDecode",
        `/Length ${logo.data.length}`,
        ">>\nstream\n",
      ].join(" "),
      logo.data,
      "\nendstream",
    ];
  }

  pageStreams.forEach((stream, index) => {
    const pageObjectId = firstPageObjectId + index * 2;
    const contentObjectId = pageObjectId + 1;
    const xObjects = logoObjectId
      ? `/XObject << /Logo ${logoObjectId} 0 R >>`
      : "";

    pageRefs.push(`${pageObjectId} 0 R`);
    objectBodies[pageObjectId - 1] = [
      "<< /Type /Page",
      "/Parent 2 0 R",
      `/MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}]`,
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> ${xObjects} >>`,
      `/Contents ${contentObjectId} 0 R`,
      ">>",
    ].join(" ");
    objectBodies[contentObjectId - 1] =
      `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`;
  });

  objectBodies[1] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pageRefs.length} >>`;

  const chunks: Array<string | Buffer> = ["%PDF-1.4\n"];
  const offsets = [0];

  objectBodies.forEach((body, index) => {
    offsets[index + 1] = getChunksLength(chunks);
    chunks.push(`${index + 1} 0 obj\n`);
    pushBody(chunks, body);
    chunks.push("\nendobj\n");
  });

  const xrefOffset = getChunksLength(chunks);
  chunks.push(`xref\n0 ${objectBodies.length + 1}\n`);
  chunks.push("0000000000 65535 f \n");
  for (let index = 1; index <= objectBodies.length; index += 1) {
    chunks.push(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`);
  }
  chunks.push(
    [
      "trailer",
      `<< /Size ${objectBodies.length + 1} /Root 1 0 R >>`,
      "startxref",
      String(xrefOffset),
      "%%EOF",
    ].join("\n"),
  );

  return Buffer.concat(
    chunks.map((chunk) =>
      typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk,
    ),
  );
}

function pushBody(chunks: Array<string | Buffer>, body: PdfObjectBody) {
  if (Array.isArray(body)) {
    chunks.push(...body);
    return;
  }

  chunks.push(body);
}

function getChunksLength(chunks: Array<string | Buffer>) {
  return chunks.reduce(
    (total, chunk) =>
      total +
      (typeof chunk === "string" ? Buffer.byteLength(chunk, "utf8") : chunk.length),
    0,
  );
}

function loadAfisecLogo() {
  try {
    return parsePngForPdf(readFileSync(AFISEC_LOGO_PATH));
  } catch {
    return null;
  }
}

function parsePngForPdf(file: Buffer): PdfImage {
  const signature = file.subarray(0, 8).toString("hex");

  if (signature !== "89504e470d0a1a0a") {
    throw new Error("Logo PNG inválido.");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.subarray(offset + 4, offset + 8).toString("ascii");
    const data = file.subarray(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
    }

    if (type === "IDAT") {
      idatChunks.push(data);
    }

    if (type === "IEND") {
      break;
    }

    offset += length + 12;
  }

  if (!width || !height || bitDepth !== 8 || ![2, 6].includes(colorType)) {
    throw new Error("Logo PNG no soportado para PDF.");
  }

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const stride = width * bytesPerPixel;
  const pixels = Buffer.alloc(width * height * 3);
  let inputOffset = 0;
  let outputOffset = 0;
  let previousRow = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const filteredRow = inflated.subarray(inputOffset, inputOffset + stride);
    inputOffset += stride;
    const row = unfilterPngRow(filteredRow, previousRow, bytesPerPixel, filter);

    for (let x = 0; x < width; x += 1) {
      const pixelOffset = x * bytesPerPixel;
      const alpha = colorType === 6 ? row[pixelOffset + 3] / 255 : 1;

      pixels[outputOffset] = compositeOnWhite(row[pixelOffset], alpha);
      pixels[outputOffset + 1] = compositeOnWhite(row[pixelOffset + 1], alpha);
      pixels[outputOffset + 2] = compositeOnWhite(row[pixelOffset + 2], alpha);
      outputOffset += 3;
    }

    previousRow = row;
  }

  return {
    width,
    height,
    data: deflateSync(pixels),
  };
}

function unfilterPngRow(
  filteredRow: Buffer,
  previousRow: Buffer,
  bytesPerPixel: number,
  filter: number,
) {
  const row = Buffer.alloc(filteredRow.length);

  for (let index = 0; index < filteredRow.length; index += 1) {
    const raw = filteredRow[index];
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
    const up = previousRow[index] ?? 0;
    const upperLeft =
      index >= bytesPerPixel ? previousRow[index - bytesPerPixel] : 0;

    if (filter === 0) {
      row[index] = raw;
    } else if (filter === 1) {
      row[index] = (raw + left) & 0xff;
    } else if (filter === 2) {
      row[index] = (raw + up) & 0xff;
    } else if (filter === 3) {
      row[index] = (raw + Math.floor((left + up) / 2)) & 0xff;
    } else if (filter === 4) {
      row[index] = (raw + paethPredictor(left, up, upperLeft)) & 0xff;
    } else {
      throw new Error("Filtro PNG no soportado.");
    }
  }

  return row;
}

function paethPredictor(left: number, up: number, upperLeft: number) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);

  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) {
    return left;
  }

  if (upDistance <= upperLeftDistance) {
    return up;
  }

  return upperLeft;
}

function compositeOnWhite(value: number, alpha: number) {
  return Math.round(value * alpha + 255 * (1 - alpha));
}

function toPdfText(value: string) {
  const bytes = Array.from(normalizePdfText(value)).map((char) =>
    winAnsiCode(char),
  );

  return `<${bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")}>`;
}

function wrapTextToWidth(value: string, maxWidth: number, fontSize: number) {
  const words = normalizePdfText(value).split(" ");
  const lines: string[] = [];
  let current = "";

  words.forEach((word) => {
    const chunks = splitLongWord(word, maxWidth, fontSize);

    chunks.forEach((chunk) => {
      const next = current ? `${current} ${chunk}` : chunk;

      if (estimateTextWidthStatic(next, fontSize) <= maxWidth) {
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

function splitLongWord(word: string, maxWidth: number, fontSize: number) {
  if (estimateTextWidthStatic(word, fontSize) <= maxWidth) {
    return [word];
  }

  const chunks: string[] = [];
  let current = "";

  Array.from(word).forEach((char) => {
    const next = `${current}${char}`;

    if (current && estimateTextWidthStatic(next, fontSize) > maxWidth) {
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

function estimateTextWidthStatic(text: string, fontSize: number) {
  return Array.from(text).reduce(
    (total, char) => total + getApproxCharWidth(char, fontSize),
    0,
  );
}

function getApproxCharWidth(char: string, fontSize: number) {
  if (char === " ") {
    return fontSize * 0.26;
  }

  if (/[.,:;|/\\!¡'`´]/.test(char)) {
    return fontSize * 0.24;
  }

  if (/[0-9$]/.test(char)) {
    return fontSize * 0.48;
  }

  if (/[A-ZÁÉÍÓÚÜÑ]/.test(char)) {
    return fontSize * 0.56;
  }

  if (/[mwMW]/.test(char)) {
    return fontSize * 0.72;
  }

  if (/[ilIíÍ]/.test(char)) {
    return fontSize * 0.25;
  }

  return fontSize * 0.48;
}

function normalizePdfText(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/•/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function winAnsiCode(char: string) {
  const specialCodes: Record<string, number> = {
    "€": 0x80,
    "‚": 0x82,
    "ƒ": 0x83,
    "„": 0x84,
    "…": 0x85,
    "†": 0x86,
    "‡": 0x87,
    "ˆ": 0x88,
    "‰": 0x89,
    "Š": 0x8a,
    "‹": 0x8b,
    "Œ": 0x8c,
    "Ž": 0x8e,
    "‘": 0x91,
    "’": 0x92,
    "“": 0x93,
    "”": 0x94,
    "•": 0x95,
    "–": 0x96,
    "—": 0x97,
    "˜": 0x98,
    "™": 0x99,
    "š": 0x9a,
    "›": 0x9b,
    "œ": 0x9c,
    "ž": 0x9e,
    "Ÿ": 0x9f,
  };
  const code = char.charCodeAt(0);

  if (specialCodes[char]) {
    return specialCodes[char];
  }

  if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) {
    return code;
  }

  return "?".charCodeAt(0);
}

function getIncludedSubcoverages(
  subcoverages: QuoteSnapshotSubcoverage[] | undefined,
) {
  return Array.isArray(subcoverages)
    ? subcoverages.filter((subcoverage) => subcoverage.incluido)
    : [];
}

function isCivilLiabilityCoverage(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return (
    normalized.includes("responsabilidad_civil") ||
    normalized.includes("responsabilidad civil") ||
    normalized.includes("extracontractual") ||
    normalized.includes("plo")
  );
}

function formatSubcoveragesForPdf(
  subcoverages: QuoteSnapshotSubcoverage[],
  currency: string,
) {
  return subcoverages
    .map((subcoverage) => {
      const sublimit =
        subcoverage.valor_sublimite === null
          ? ""
          : ` (${formatMoney(subcoverage.valor_sublimite, currency)})`;

      return `${subcoverage.nombre}${sublimit}`;
    })
    .join("; ");
}

function formatMoney(value: number | null, currency = "COP") {
  if (value === null || !Number.isFinite(value)) {
    return "Sin valor";
  }

  const amount = new Intl.NumberFormat("es-CO", {
    style: "decimal",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(value);

  if (currency === "COP" || !currency) {
    return `$ ${amount}`;
  }

  return `${currency} ${amount}`;
}

function formatDate(value: string | null) {
  if (!value) {
    return "Sin fecha";
  }

  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);

  if (!Number.isFinite(date.getTime())) {
    return "Sin fecha";
  }

  return new Intl.DateTimeFormat("es-CO", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function formatCompactDate(value: string | null) {
  if (!value) {
    return "Sin dato";
  }

  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);

  if (!Number.isFinite(date.getTime())) {
    return "Sin dato";
  }

  return new Intl.DateTimeFormat("es-CO", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function formatCommercialObservation(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (normalized.includes("cotizacion sujeta")) {
    return "Cotización sujeta a aprobación final de la aseguradora.";
  }

  if (normalized.includes("no constituye poliza")) {
    return "Esta cotización no constituye póliza emitida ni cobertura vigente hasta su expedición formal por la aseguradora.";
  }

  return value;
}
