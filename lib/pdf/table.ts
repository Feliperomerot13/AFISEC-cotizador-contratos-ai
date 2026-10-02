import {
  fitFontSize,
  measureText,
  normalizePdfText,
  toPdfText,
  wrapText,
} from "@/lib/pdf/text";

export type PdfTableCell = {
  text: string;
  width: number;
  align?: "left" | "right" | "center";
  bold?: boolean;
  fill?: string;
  color?: string;
  // Una sola línea sin partir; si no cabe, reduce la fuente (cifras y fechas).
  // Por defecto aplica a las celdas alineadas a la derecha, que son numéricas.
  nowrap?: boolean;
  // Líneas ya resueltas, usadas al dividir filas más altas que una página.
  lines?: string[];
};

export type TableRowOptions = {
  x?: number;
  y?: number;
  fontSize: number;
  lineHeight: number;
  minHeight: number;
  // Mantiene todas las filas en la misma página si caben en una.
  keepTogether?: boolean;
};

type TablePage = {
  commands: string[];
  y: number;
};

export type TableEngineContext = {
  page: () => TablePage;
  newPage: () => void;
  marginX: number;
  topY: number;
  bottomY: number;
  border: string;
  borderWidth: number;
  textTop: number;
};

const CELL_PADDING = 4;

function isNoWrap(cell: PdfTableCell) {
  return cell.nowrap ?? cell.align === "right";
}

export function createTableEngine(context: TableEngineContext) {
  const { marginX, topY, bottomY } = context;

  function getCellLines(cell: PdfTableCell, fontSize: number) {
    if (cell.lines) {
      return cell.lines;
    }

    if (isNoWrap(cell)) {
      return [normalizePdfText(cell.text)];
    }

    return wrapText(
      cell.text,
      Math.max(8, cell.width - CELL_PADDING * 2),
      fontSize,
      cell.bold,
    );
  }

  function getRowHeight(
    row: PdfTableCell[],
    fontSize: number,
    lineHeight: number,
    minHeight: number,
  ) {
    const lineCount = Math.max(
      ...row.map((cell) => getCellLines(cell, fontSize).length),
      1,
    );

    return Math.max(minHeight, 8 + lineCount * lineHeight);
  }

  function getAlignedTextX(
    x: number,
    width: number,
    textWidth: number,
    align: "left" | "right" | "center",
  ) {
    if (align === "right") {
      return x + width - textWidth - CELL_PADDING;
    }

    if (align === "center") {
      return x + (width - textWidth) / 2;
    }

    return x + CELL_PADDING;
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
    const current = context.page();
    let x = options.x;

    row.forEach((cell) => {
      const fill = cell.fill ?? "1 1 1";

      current.commands.push(
        `${fill} rg ${x} ${options.y - options.height} ${cell.width} ${options.height} re f`,
        `${context.border} RG ${context.borderWidth} w ${x} ${options.y - options.height} ${cell.width} ${options.height} re S`,
      );

      x += cell.width;
    });

    x = options.x;

    row.forEach((cell) => {
      const lines = getCellLines(cell, options.fontSize);
      const available = cell.width - CELL_PADDING * 2;

      lines.forEach((line, lineIndex) => {
        const lineFontSize = isNoWrap(cell)
          ? fitFontSize(line, available, options.fontSize, cell.bold)
          : options.fontSize;
        const textWidth = measureText(line, lineFontSize, cell.bold);
        const textX = getAlignedTextX(
          x,
          cell.width,
          textWidth,
          cell.align ?? "left",
        );
        const textY =
          options.y -
          context.textTop -
          options.fontSize -
          lineIndex * options.lineHeight;

        current.commands.push(
          `${cell.color ?? "0 0 0"} rg BT /${cell.bold ? "F2" : "F1"} ${lineFontSize} Tf 1 0 0 1 ${textX} ${textY} Tm ${toPdfText(line)} Tj ET`,
        );
      });

      x += cell.width;
    });
  }

  // Divide una fila más alta que una página completa en fragmentos continuos.
  function splitTallRow(row: PdfTableCell[], options: TableRowOptions) {
    const capacity = Math.max(
      1,
      Math.floor((topY - bottomY - 8) / options.lineHeight),
    );
    const cellLines = row.map((cell) => getCellLines(cell, options.fontSize));
    const maxLines = Math.max(...cellLines.map((lines) => lines.length), 1);

    if (maxLines <= capacity) {
      return [row];
    }

    const fragments: PdfTableCell[][] = [];

    for (let start = 0; start < maxLines; start += capacity) {
      fragments.push(
        row.map((cell, index) => ({
          ...cell,
          lines: cellLines[index].slice(start, start + capacity),
        })),
      );
    }

    return fragments;
  }

  function addTableRows(rows: PdfTableCell[][], options: TableRowOptions) {
    const flowing = typeof options.y !== "number";
    const expanded = flowing
      ? rows.flatMap((row) => splitTallRow(row, options))
      : rows;

    if (flowing && options.keepTogether) {
      const total = expanded.reduce(
        (sum, row) =>
          sum +
          getRowHeight(row, options.fontSize, options.lineHeight, options.minHeight),
        0,
      );

      if (total <= topY - bottomY && context.page().y - total < bottomY) {
        context.newPage();
      }
    }

    let y = options.y ?? context.page().y;

    expanded.forEach((row) => {
      const rowHeight = getRowHeight(
        row,
        options.fontSize,
        options.lineHeight,
        options.minHeight,
      );

      if (flowing && context.page().y - rowHeight < bottomY) {
        context.newPage();
        y = context.page().y;
      }

      drawTableRow(row, {
        x: options.x ?? marginX,
        y,
        height: rowHeight,
        fontSize: options.fontSize,
        lineHeight: options.lineHeight,
      });

      y -= rowHeight;

      if (flowing) {
        context.page().y -= rowHeight;
      }
    });
  }

  return { addTableRows, getRowHeight };
}
