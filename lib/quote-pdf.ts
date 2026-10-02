import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { createTableEngine, type PdfTableCell } from "@/lib/pdf/table";
import { toPdfText } from "@/lib/pdf/text";
import {
  formatCoverageName,
  getQuoteCommercialIssues,
  groupQuoteCoveragesByPolicy,
  type QuotePolicyGroup,
  type QuoteSnapshot,
  type QuoteSnapshotCoverage,
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
const SOFT_FILL = "0.985 0.985 0.985";
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

  const { addTableRows, getRowHeight } = createTableEngine({
    page,
    newPage,
    marginX: MARGIN_X,
    topY: TOP_Y,
    bottomY: BOTTOM_Y,
    border: TABLE_BORDER,
    borderWidth: 0.4,
    textTop: 6,
  });

  function addHeader() {
    ensureSpace(96);
    const current = page();
    const commercialContact = snapshot.comercial;

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
    );

    if (commercialContact) {
      current.commands.push(
        `${AFISEC_GRAY} rg BT /F1 8 Tf 1 0 0 1 ${MARGIN_X + 58} ${current.y - 31} Tm ${toPdfText(`${commercialContact.nombre} · ${commercialContact.cargo}`)} Tj ET`,
        `${AFISEC_GRAY} rg BT /F1 8 Tf 1 0 0 1 ${MARGIN_X + 58} ${current.y - 43} Tm ${toPdfText(`${commercialContact.correo} · ${commercialContact.telefono}`)} Tj ET`,
        `${AFISEC_GRAY} rg BT /F1 7.5 Tf 1 0 0 1 ${MARGIN_X + 58} ${current.y - 55} Tm ${toPdfText(`${commercialContact.sitio_web} · ${commercialContact.direccion}`)} Tj ET`,
      );
    } else if (snapshot.cliente.ejecutivo) {
      current.commands.push(
        `${AFISEC_GRAY} rg BT /F1 8 Tf 1 0 0 1 ${MARGIN_X + 58} ${current.y - 31} Tm ${toPdfText(`Comercial: ${snapshot.cliente.ejecutivo}`)} Tj ET`,
      );
    }

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
          { text: "Tomador", width: 84, bold: true, fill: TABLE_HEADER },
          { text: snapshot.cliente.nombre, width: 186 },
          { text: "NIT", width: 84, bold: true, fill: TABLE_HEADER },
          { text: snapshot.cliente.nit, width: 186 },
        ],
        [
          { text: "Ejecutiva", width: 84, bold: true, fill: TABLE_HEADER },
          { text: snapshot.cliente.ejecutivo, width: 186 },
          { text: "Contrato / orden", width: 84, bold: true, fill: TABLE_HEADER },
          { text: snapshot.contrato.numero_contrato ?? "Sin número", width: 186 },
        ],
        [
          {
            text: "Asegurado / contratante",
            width: 84,
            bold: true,
            fill: TABLE_HEADER,
          },
          { text: snapshot.contrato.contratante ?? "Sin dato", width: 186 },
          { text: "Contratista", width: 84, bold: true, fill: TABLE_HEADER },
          { text: snapshot.contrato.contratista ?? "Sin dato", width: 186 },
        ],
        [
          { text: "Valor base", width: 84, bold: true, fill: TABLE_HEADER },
          {
            text: formatMoney(
              snapshot.contrato.base_calculo_amparos ??
                snapshot.contrato.valor_contrato,
              snapshot.contrato.moneda,
            ),
            width: 186,
          },
          { text: "Base incluye IVA", width: 84, bold: true, fill: TABLE_HEADER },
          {
            text: getBaseIncludesIvaLabel(
              snapshot.contrato.base_calculo_incluye_iva,
            ),
            width: 186,
          },
        ],
        [
          { text: "Vigencia general", width: 84, bold: true, fill: TABLE_HEADER },
          {
            text: `${formatDate(snapshot.contrato.fecha_inicio)} a ${formatDate(snapshot.contrato.fecha_fin)}`,
            width: 456,
          },
        ],
        [
          { text: "Objeto resumido", width: 84, bold: true, fill: TABLE_HEADER },
          { text: snapshot.contrato.objeto ?? "Sin dato", width: 456 },
        ],
      ],
      {
        fontSize: 7.5,
        lineHeight: 9,
        minHeight: 18,
      },
    );
    page().y -= 18;
  }

  const coverageHeader: PdfTableCell[] = [
    { text: "Amparo", width: 150, bold: true, fill: TABLE_HEADER },
    { text: "Valor asegurado", width: 82, bold: true, fill: TABLE_HEADER, align: "right" },
    { text: "Desde", width: 42, bold: true, fill: TABLE_HEADER },
    { text: "Hasta", width: 42, bold: true, fill: TABLE_HEADER },
    { text: "Días", width: 28, bold: true, fill: TABLE_HEADER, align: "right" },
    { text: "Prima neta", width: 70, bold: true, fill: TABLE_HEADER, align: "right" },
    { text: "IVA", width: 56, bold: true, fill: TABLE_HEADER, align: "right" },
    { text: "Prima total", width: 70, bold: true, fill: TABLE_HEADER, align: "right" },
  ];
  const headerStyle = { fontSize: 7, lineHeight: 8.5, minHeight: 20 };
  const rowStyle = { fontSize: 6.4, lineHeight: 8.2, minHeight: 24 };

  function buildCoverageRow(amparo: QuoteSnapshotCoverage): PdfTableCell[] {
    const currency = snapshot.contrato.moneda;

    return [
      { text: formatCoverageName(amparo.tipo_amparo), width: 150 },
      { text: formatMoney(amparo.valor_asegurado, currency), width: 82, align: "right" },
      { text: formatCompactDate(amparo.fecha_desde), width: 42, nowrap: true },
      { text: formatCompactDate(amparo.fecha_hasta), width: 42, nowrap: true },
      {
        text: amparo.dias_vigencia === null ? "Sin dato" : String(amparo.dias_vigencia),
        width: 28,
        align: "right",
      },
      { text: formatMoney(amparo.prima_neta, currency), width: 70, align: "right" },
      { text: formatMoney(amparo.iva, currency), width: 56, align: "right" },
      { text: formatMoney(amparo.prima_total, currency), width: 70, align: "right" },
    ];
  }

  function addCoverageRows(amparos: QuoteSnapshotCoverage[]) {
    amparos.forEach((amparo) => {
      const row = buildCoverageRow(amparo);

      if (page().y - getRowHeight(row, rowStyle.fontSize, rowStyle.lineHeight, rowStyle.minHeight) < BOTTOM_Y) {
        newPage();
        addTableRows([coverageHeader], headerStyle);
      }

      addTableRows([row], rowStyle);
    });
  }

  function addSubcoverageBlock(amparos: QuoteSnapshotCoverage[]) {
    const subcoverages = amparos.flatMap((amparo) =>
      amparo.subamparos.filter((subamparo) => subamparo.incluido),
    );

    if (subcoverages.length === 0) {
      return;
    }

    const indent = 14;
    const currency = snapshot.contrato.moneda;
    const subHeader: PdfTableCell[] = [
      { text: "Subamparos incluidos", width: 222, bold: true, fill: TABLE_HEADER },
      { text: "% sublímite", width: 70, bold: true, fill: TABLE_HEADER, align: "right" },
      { text: "Valor sublímite", width: 110, bold: true, fill: TABLE_HEADER, align: "right" },
      { text: "Prima", width: 124, bold: true, fill: TABLE_HEADER },
    ];

    addTableRows(
      [
        subHeader,
        ...subcoverages.map((subamparo): PdfTableCell[] => [
          { text: subamparo.nombre, width: 222 },
          { text: formatSublimitPercent(subamparo.porcentaje_sublimite), width: 70, align: "right" },
          { text: formatMoney(subamparo.valor_sublimite, currency), width: 110, align: "right" },
          {
            text: subamparo.calculable ? "Línea principal" : "Sin prima individual",
            width: 124,
            color: subamparo.calculable ? undefined : AFISEC_GRAY,
          },
        ]),
      ],
      { x: MARGIN_X + indent, ...rowStyle, minHeight: 16, keepTogether: true },
    );
    addTableRows(
      [
        [
          {
            text: "La prima de esta póliza corresponde a la línea principal RCE/PLO; los subamparos no generan prima individual.",
            width: CONTENT_WIDTH - indent,
            fill: SOFT_FILL,
            color: AFISEC_GRAY,
          },
        ],
      ],
      { x: MARGIN_X + indent, ...rowStyle, minHeight: 16 },
    );
  }

  function addPolicyTotal(group: QuotePolicyGroup) {
    const currency = snapshot.contrato.moneda;
    const label = `Total ${group.nombre.charAt(0).toLowerCase()}${group.nombre.slice(1)}`;

    addTableRows(
      [
        [
          { text: label, width: 344, bold: true, fill: TABLE_HEADER },
          { text: formatMoney(group.totales.prima_neta, currency), width: 70, bold: true, fill: TABLE_HEADER, align: "right" },
          { text: formatMoney(group.totales.iva, currency), width: 56, bold: true, fill: TABLE_HEADER, align: "right" },
          { text: formatMoney(group.totales.prima_total, currency), width: 70, bold: true, fill: TABLE_HEADER, align: "right", color: AFISEC_PRIMARY },
        ],
      ],
      { fontSize: 7.5, lineHeight: 9, minHeight: 20, keepTogether: true },
    );
  }

  function addPolicySection(group: QuotePolicyGroup) {
    const firstRow = buildCoverageRow(group.amparos[0]);

    ensureSpace(
      14 +
        20 +
        getRowHeight(firstRow, rowStyle.fontSize, rowStyle.lineHeight, rowStyle.minHeight),
    );
    addSectionTitle(group.nombre.toUpperCase());
    addTableRows([coverageHeader], headerStyle);
    addCoverageRows(group.amparos);
    addSubcoverageBlock(group.amparos);
    addPolicyTotal(group);
    page().y -= 18;
  }

  function addPolicies() {
    const groups = groupQuoteCoveragesByPolicy(snapshot.amparos);

    if (groups.length === 0) {
      addSectionTitle("Amparos cotizados");
      addTableRows(
        [[{ text: "No se registran amparos cotizados.", width: CONTENT_WIDTH }]],
        { fontSize: 7.5, lineHeight: 9, minHeight: 20 },
      );
      page().y -= 18;
      return;
    }

    groups.forEach(addPolicySection);
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

  function getBaseIncludesIvaLabel(value: boolean | null) {
    if (value === null) {
      return "No determinado";
    }

    return value ? "Sí" : "No";
  }

  newPage();
  addHeader();
  addGeneralInfoTable();
  addPolicies();
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

function formatMoney(value: number | null, currency = "COP") {
  if (value === null || !Number.isFinite(value)) {
    return "Sin valor";
  }

  const amount = new Intl.NumberFormat("es-CO", {
    style: "decimal",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
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

function formatSublimitPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "Sin dato";
  }

  return `${Number((value * 100).toFixed(2))}%`;
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
