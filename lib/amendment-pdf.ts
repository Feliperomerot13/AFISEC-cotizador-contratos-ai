import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import type {
  AmendmentLiquidationRow,
  AmendmentQuoteSnapshot,
} from "@/lib/amendments";

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

const PAGE_WIDTH = 792;
const PAGE_HEIGHT = 612;
const MARGIN_X = 32;
const TOP_Y = 570;
const BOTTOM_Y = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const AFISEC_PRIMARY = "0.824 0.357 0.188";
const AFISEC_GRAY = "0.478 0.478 0.478";
const TABLE_BORDER = "0.86 0.86 0.86";
const TABLE_HEADER = "0.96 0.94 0.93";
const SOFT_FILL = "0.985 0.985 0.985";
const AFISEC_LOGO_PATH = join(
  process.cwd(),
  "public",
  "brand",
  "Logo_Color_Afisec_cuadrado.png",
);

export function generateAmendmentQuotePdf(snapshot: AmendmentQuoteSnapshot) {
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
    ensureSpace(80);
    const current = page();

    if (logo) {
      current.commands.push(
        `q 42 0 0 50 ${MARGIN_X} ${current.y - 48} cm /Logo Do Q`,
      );
    }

    current.commands.push(
      `${AFISEC_PRIMARY} rg BT /F2 16 Tf 1 0 0 1 ${MARGIN_X + 56} ${current.y - 14} Tm ${toPdfText("Cotización de ajuste por otrosí")} Tj ET`,
      `${AFISEC_GRAY} rg BT /F1 8 Tf 1 0 0 1 ${MARGIN_X + 56} ${current.y - 29} Tm ${toPdfText("AFISEC | Garantías contractuales")} Tj ET`,
    );

    addTableRows(
      [
        [
          { text: "Cotización", width: 78, bold: true, fill: TABLE_HEADER },
          { text: snapshot.numero_cotizacion, width: 134 },
        ],
        [
          { text: "Versión", width: 78, bold: true, fill: TABLE_HEADER },
          { text: `v${snapshot.version}`, width: 134 },
        ],
        [
          { text: "Fecha", width: 78, bold: true, fill: TABLE_HEADER },
          { text: formatDate(snapshot.generado_en), width: 134 },
        ],
      ],
      {
        x: PAGE_WIDTH - MARGIN_X - 212,
        y: current.y - 4,
        fontSize: 7.2,
        lineHeight: 8.6,
        minHeight: 16,
      },
    );

    current.commands.push(
      `${AFISEC_PRIMARY} RG 1.4 w ${MARGIN_X} ${current.y - 66} m ${PAGE_WIDTH - MARGIN_X} ${current.y - 66} l S`,
    );
    current.y -= 80;
  }

  function addSectionTitle(title: string) {
    ensureSpace(24);
    page().commands.push(
      `${AFISEC_PRIMARY} rg BT /F2 10.5 Tf 1 0 0 1 ${MARGIN_X} ${page().y} Tm ${toPdfText(title)} Tj ET`,
    );
    page().y -= 13;
  }

  function addGeneralInfo() {
    addSectionTitle("Información general");
    addTableRows(
      [
        [
          { text: "Cliente", width: 70, bold: true, fill: TABLE_HEADER },
          { text: snapshot.cliente.nombre, width: 174 },
          { text: "NIT", width: 50, bold: true, fill: TABLE_HEADER },
          { text: snapshot.cliente.nit, width: 114 },
          { text: "Ejecutiva", width: 66, bold: true, fill: TABLE_HEADER },
          { text: snapshot.cliente.ejecutivo, width: 254 },
        ],
        [
          { text: "Contrato", width: 70, bold: true, fill: TABLE_HEADER },
          { text: snapshot.contrato.numero_contrato ?? "Sin número", width: 174 },
          { text: "Otrosí", width: 50, bold: true, fill: TABLE_HEADER },
          {
            text:
              snapshot.modificacion.numero_modificacion ??
              `Otrosí ${snapshot.modificacion.secuencia}`,
            width: 114,
          },
          { text: "Póliza base", width: 66, bold: true, fill: TABLE_HEADER },
          {
            text: `${snapshot.poliza_base.numero_cotizacion} v${snapshot.poliza_base.version}`,
            width: 254,
          },
        ],
        [
          { text: "Contratante", width: 70, bold: true, fill: TABLE_HEADER },
          { text: snapshot.contrato.contratante ?? "Sin dato", width: 338 },
          { text: "Contratista", width: 66, bold: true, fill: TABLE_HEADER },
          { text: snapshot.contrato.contratista ?? "Sin dato", width: 254 },
        ],
      ],
      {
        fontSize: 7,
        lineHeight: 8.2,
        minHeight: 18,
      },
    );
    page().y -= 10;
  }

  function addDeltaTable() {
    addSectionTitle("Delta revisado");
    addTableRows(
      [
        [
          { text: "Valor anterior", width: 90, bold: true, fill: TABLE_HEADER },
          {
            text: formatMoney(
              snapshot.modificacion.valor_contrato_anterior,
              snapshot.contrato.moneda,
            ),
            width: 134,
            align: "right",
          },
          { text: "Valor adicionado", width: 92, bold: true, fill: TABLE_HEADER },
          {
            text: formatMoney(
              snapshot.modificacion.valor_adicion,
              snapshot.contrato.moneda,
            ),
            width: 132,
            align: "right",
          },
          { text: "Valor acumulado", width: 94, bold: true, fill: TABLE_HEADER },
          {
            text: formatMoney(
              snapshot.modificacion.valor_contrato_acumulado,
              snapshot.contrato.moneda,
            ),
            width: 186,
            align: "right",
          },
        ],
        [
          { text: "Fecha fin anterior", width: 90, bold: true, fill: TABLE_HEADER },
          { text: formatDate(snapshot.modificacion.fecha_fin_anterior), width: 134 },
          { text: "Nueva fecha fin", width: 92, bold: true, fill: TABLE_HEADER },
          { text: formatDate(snapshot.modificacion.nueva_fecha_fin), width: 132 },
          { text: "Días prórroga", width: 94, bold: true, fill: TABLE_HEADER },
          {
            text: String(snapshot.modificacion.dias_prorroga ?? 0),
            width: 186,
            align: "right",
          },
        ],
        [
          { text: "Objeto ajustado", width: 90, bold: true, fill: TABLE_HEADER },
          {
            text:
              snapshot.modificacion.objeto_nuevo ??
              snapshot.contrato.objeto ??
              "Sin cambio registrado",
            width: 638,
          },
        ],
      ],
      {
        fontSize: 7,
        lineHeight: 8.2,
        minHeight: 18,
      },
    );
    page().y -= 10;
  }

  function addLiquidationTable() {
    addSectionTitle("Liquidación incremental");
    const header: PdfTableCell[] = [
      { text: "Amparo", width: 132, bold: true, fill: TABLE_HEADER },
      { text: "VA vigente", width: 76, bold: true, fill: TABLE_HEADER, align: "right" },
      { text: "VA adición", width: 76, bold: true, fill: TABLE_HEADER, align: "right" },
      { text: "VA acumulado", width: 82, bold: true, fill: TABLE_HEADER, align: "right" },
      { text: "Nueva fecha fin contrato", width: 54, bold: true, fill: TABLE_HEADER },
      { text: "Días", width: 34, bold: true, fill: TABLE_HEADER, align: "right" },
      { text: "Prima adición", width: 82, bold: true, fill: TABLE_HEADER, align: "right" },
      { text: "Prima prórroga", width: 84, bold: true, fill: TABLE_HEADER, align: "right" },
      { text: "IVA", width: 50, bold: true, fill: TABLE_HEADER, align: "right" },
      { text: "Total", width: 58, bold: true, fill: TABLE_HEADER, align: "right" },
    ];

    addTableRows([header], {
      fontSize: 6.4,
      lineHeight: 7.8,
      minHeight: 20,
    });

    snapshot.liquidacion.rows.forEach((row) => {
      addLiquidationRow(row, header);
    });

    page().y -= 8;
  }

  function addLiquidationRow(row: AmendmentLiquidationRow, header: PdfTableCell[]) {
    const cells: PdfTableCell[] = [
      { text: row.nombre_amparo, width: 132 },
      {
        text: formatMoney(row.valor_asegurado_vigente, snapshot.contrato.moneda),
        width: 76,
        align: "right",
      },
      {
        text: formatMoney(row.valor_asegurado_adicion, snapshot.contrato.moneda),
        width: 76,
        align: "right",
      },
      {
        text: formatMoney(row.valor_asegurado_acumulado, snapshot.contrato.moneda),
        width: 82,
        align: "right",
      },
      { text: formatCompactDate(row.fecha_hasta), width: 54 },
      { text: String(row.dias_prorroga), width: 34, align: "right" },
      {
        text: formatMoney(row.prima_valor_adicionado, snapshot.contrato.moneda),
        width: 82,
        align: "right",
      },
      {
        text: formatMoney(row.prima_prorroga, snapshot.contrato.moneda),
        width: 84,
        align: "right",
      },
      { text: formatMoney(row.iva, snapshot.contrato.moneda), width: 50, align: "right" },
      {
        text: formatMoney(row.prima_total, snapshot.contrato.moneda),
        width: 58,
        align: "right",
      },
    ];
    const rowHeight = getRowHeight(cells, 6.1, 7.5, 22);

    if (page().y - rowHeight < BOTTOM_Y) {
      newPage();
      addTableRows([header], {
        fontSize: 6.4,
        lineHeight: 7.8,
        minHeight: 20,
      });
    }

    addTableRows([cells], {
      fontSize: 6.1,
      lineHeight: 7.5,
      minHeight: 22,
    });

    if (row.es_rce && row.subamparos.length > 0) {
      addTableRows(
        [
          [
            {
              text: `Subamparos RCE/PLO informativos, sin prima individual: ${formatSubcoverages(row.subamparos, snapshot.contrato.moneda)}. La prima corresponde únicamente a la línea principal.`,
              width: CONTENT_WIDTH,
              fill: SOFT_FILL,
              color: AFISEC_GRAY,
            },
          ],
        ],
        {
          fontSize: 6.3,
          lineHeight: 7.7,
          minHeight: 18,
        },
      );
    }
  }

  function addTotals() {
    ensureSpace(86);
    addSectionTitle("Totales");
    addTableRows(
      [
        [
          { text: "Prima por valor adicionado", width: 168, bold: true, fill: TABLE_HEADER },
          {
            text: formatMoney(
              snapshot.liquidacion.totales.prima_valor_adicionado,
              snapshot.contrato.moneda,
            ),
            width: 130,
            align: "right",
          },
        ],
        [
          { text: "Prima por prórroga", width: 168, bold: true, fill: TABLE_HEADER },
          {
            text: formatMoney(
              snapshot.liquidacion.totales.prima_prorroga,
              snapshot.contrato.moneda,
            ),
            width: 130,
            align: "right",
          },
        ],
        [
          { text: "IVA", width: 168, bold: true, fill: TABLE_HEADER },
          {
            text: formatMoney(snapshot.liquidacion.totales.iva, snapshot.contrato.moneda),
            width: 130,
            align: "right",
          },
        ],
        [
          { text: "Total ajuste", width: 168, bold: true, fill: TABLE_HEADER },
          {
            text: formatMoney(
              snapshot.liquidacion.totales.prima_total,
              snapshot.contrato.moneda,
            ),
            width: 130,
            align: "right",
            bold: true,
            color: AFISEC_PRIMARY,
          },
        ],
      ],
      {
        x: PAGE_WIDTH - MARGIN_X - 298,
        fontSize: 7.4,
        lineHeight: 9,
        minHeight: 18,
      },
    );
    page().y -= 8;
  }

  function addNotes() {
    ensureSpace(64);
    addSectionTitle("Observaciones comerciales");
    const notes = [
      ...getCommercialAmendmentNotes(snapshot),
    ];

    addTableRows(
      notes.map((note) => [{ text: note, width: CONTENT_WIDTH }]),
      {
        fontSize: 7,
        lineHeight: 8.4,
        minHeight: 17,
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
        `${TABLE_BORDER} RG 0.35 w ${x} ${options.y - options.height} ${cell.width} ${options.height} re S`,
      );
      x += cell.width;
    });

    x = options.x;

    row.forEach((cell) => {
      const lines = getCellLines(cell.text, cell.width, options.fontSize);
      const maxLines = Math.max(
        1,
        Math.floor((options.height - 5) / options.lineHeight),
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
          options.y - 5 - options.fontSize - lineIndex * options.lineHeight;

        page().commands.push(
          `${cell.color ?? "0 0 0"} rg BT /${cell.bold ? "F2" : "F1"} ${options.fontSize} Tf 1 0 0 1 ${textX} ${textY} Tm ${toPdfText(line)} Tj ET`,
        );
      });

      x += cell.width;
    });
  }

  newPage();
  addHeader();
  addGeneralInfo();
  addDeltaTable();
  addLiquidationTable();
  addTotals();
  addNotes();

  pages.forEach((pdfPage, index) => {
    pdfPage.commands.push(
      `${AFISEC_GRAY} rg BT /F1 7.5 Tf 1 0 0 1 ${PAGE_WIDTH - 94} 24 Tm ${toPdfText(`Página ${index + 1} de ${pages.length}`)} Tj ET`,
    );
  });

  return buildPdf(
    pages.map((pdfPage) => pdfPage.commands.join("\n")),
    logo,
  );
}

function getCommercialAmendmentNotes(snapshot: AmendmentQuoteSnapshot) {
  const baseNotes = snapshot.observaciones.filter((note) =>
    isCommercialAmendmentNote(note),
  );
  const notes = baseNotes.length > 0
    ? baseNotes
    : [
        "Cotización de ajuste sujeta a aprobación final de la aseguradora.",
        "Esta cotización no constituye otrosí emitido ni cobertura vigente hasta su expedición formal.",
      ];

  if (snapshot.modificacion.dias_prorroga !== null) {
    return [
      ...notes,
      "Los días de prórroga fueron calculados con base en las fechas revisadas.",
    ];
  }

  return notes;
}

function isCommercialAmendmentNote(note: string) {
  const normalized = note
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return ![
    "alerta",
    "extraccion",
    "normalizacion",
    "ocr",
    "lectura deterministica",
    "campo",
    "campos no encontrados",
    "impuesto de timbre",
    "fuente",
    "confianza",
    "json",
  ].some((marker) => normalized.includes(marker));
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

  return Math.max(minHeight, 7 + lineCount * lineHeight);
}

function getCellLines(text: string, width: number, fontSize: number) {
  return wrapTextToWidth(text, Math.max(8, width - 7), fontSize);
}

function getAlignedTextX(
  x: number,
  width: number,
  textWidth: number,
  align: "left" | "right" | "center",
) {
  if (align === "right") {
    return x + width - textWidth - 3.5;
  }

  if (align === "center") {
    return x + (width - textWidth) / 2;
  }

  return x + 3.5;
}

function estimateTextWidth(text: string, fontSize: number) {
  return Array.from(text).reduce(
    (total, char) => total + getApproxCharWidth(char, fontSize),
    0,
  );
}

function wrapTextToWidth(value: string, maxWidth: number, fontSize: number) {
  const words = normalizePdfText(value).split(" ");
  const lines: string[] = [];
  let current = "";

  words.forEach((word) => {
    const chunks = splitLongWord(word, maxWidth, fontSize);

    chunks.forEach((chunk) => {
      const next = current ? `${current} ${chunk}` : chunk;

      if (estimateTextWidth(next, fontSize) <= maxWidth) {
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
  if (estimateTextWidth(word, fontSize) <= maxWidth) {
    return [word];
  }

  const chunks: string[] = [];
  let current = "";

  Array.from(word).forEach((char) => {
    const next = `${current}${char}`;

    if (current && estimateTextWidth(next, fontSize) > maxWidth) {
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

function toPdfText(value: string) {
  const bytes = Array.from(normalizePdfText(value)).map((char) =>
    winAnsiCode(char),
  );

  return `<${bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")}>`;
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

function formatSubcoverages(
  subcoverages: AmendmentLiquidationRow["subamparos"],
  currency: string,
) {
  return subcoverages
    .filter((subcoverage) => subcoverage.incluido)
    .map((subcoverage) => {
      const sublimit =
        subcoverage.valor_sublimite === null
          ? ""
          : ` (${formatMoney(subcoverage.valor_sublimite, currency)})`;

      return `${subcoverage.nombre}${sublimit}`;
    })
    .join("; ");
}

function formatMoney(value: number | null | undefined, currency = "COP") {
  if (value === null || typeof value === "undefined" || !Number.isFinite(value)) {
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
