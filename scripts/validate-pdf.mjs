import assert from "node:assert/strict";
import { generateAmendmentQuotePdf } from "../lib/amendment-pdf.ts";
import { measureText, normalizePdfText, wrapText } from "../lib/pdf/text.ts";
import { generateQuotePdf } from "../lib/quote-pdf.ts";
import { findOverflows, inspectPdf } from "./pdf-inspect.mjs";

// Anchos AFM publicados (milésimas de em) sumados a mano, independientes de las tablas del módulo.
assert.equal(measureText("Hello", 1000, false), 2278);
assert.equal(measureText("0123456789", 1000, false), 5560);
assert.equal(measureText("$ 1.234,56", 1000, false), 4726);
assert.equal(measureText("Hello", 1000, true), 722 + 556 + 278 + 278 + 611);
assert.equal(measureText("Ñandú", 1000, false), 722 + 556 + 556 + 556 + 556);

// Las cifras no se parten ni se separan del símbolo $.
assert.deepEqual(wrapText("$ 12.345.678.901,23", 20, 6.4), ["$", "12.345.678.901,23"]);
assert.equal(wrapText("Palabra".repeat(20), 50, 7).length > 1, true);

// NFC: un acento descompuesto no debe terminar como "?".
assert.equal(normalizePdfText("Co\u0301rdoba"), "Córdoba");

function money(value) {
  return `$ ${new Intl.NumberFormat("es-CO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`;
}

function coverage(name, value, net, extra = {}) {
  return {
    tipo_amparo: name,
    valor_asegurado: value,
    valor_base_calculo: value,
    modo_calculo: "porcentaje_valor_contrato",
    fecha_desde: "2026-01-01",
    fecha_hasta: "2027-03-31",
    dias_vigencia: 454,
    prima_neta: net,
    iva: Math.round(net * 19) / 100,
    prima_total: Math.round(net * 119) / 100,
    tasa: 0.002,
    tasa_manual: false,
    subamparos: [],
    ...extra,
  };
}

function buildSnapshot({ objeto, amparos }) {
  return {
    generado_en: "2026-10-01T10:00:00Z",
    cliente: {
      id: 1,
      nombre: "Cliente de prueba con un nombre social bastante largo S.A.S.",
      nit: "900.123.456-7",
      ejecutivo: "Carolina Barragán",
    },
    comercial: null,
    contrato: {
      id: 1,
      numero_contrato: "CTO-001-2026-ÁREA-ADMINISTRATIVA",
      objeto,
      tipo_contrato: "estatal",
      valor_contrato: 98765432100,
      base_calculo_amparos: 98765432100,
      base_calculo_incluye_iva: false,
      moneda: "COP",
      fecha_inicio: "2026-01-01",
      fecha_fin: "2026-12-31",
      plazo: null,
      contratante: "Contratante con nombre bastante largo de la entidad pública territorial",
      contratante_nit: null,
      contratista: "Contratista",
      contratista_nit: null,
    },
    amparos,
    totales: { prima_neta: null, iva: null, prima_total: null },
    observaciones: ["Cotizacion sujeta a revision y aprobacion final de la aseguradora."],
  };
}

const stress = buildSnapshot({
  objeto: "Prestación de servicios de vigilancia y seguridad privada. ".repeat(8),
  amparos: [
    coverage("cumplimiento", 19753086420, 498765432.55),
    coverage("calidad_y_estabilidad_del_servicio", 1234567890.5, 9876543210.11),
    coverage("salarios_y_prestaciones_sociales", 98765432101.23, 98765432101.23),
    coverage("responsabilidad_civil_extracontractual", 5000000000, 98765432.1, {
      subamparos: [
        { nombre: "PLO", incluido: true, calculable: true, porcentaje_sublimite: 1, valor_sublimite: 5e9 },
        { nombre: "RC Patronal", incluido: true, calculable: false, porcentaje_sublimite: 0.5, valor_sublimite: 2.5e9 },
      ],
    }),
  ],
});

const layout = { pageWidth: 612, marginX: 36 };
const quotePages = inspectPdf(generateQuotePdf({ quoteNumber: "COT-2026-1", version: 1, snapshot: stress }));
const quoteCheck = findOverflows(quotePages, layout);

assert.ok(quoteCheck.checked > 40, "se esperaban muchas celdas verificadas");
assert.deepEqual(quoteCheck.problems, [], "ningún texto debe salirse de su celda");

const allQuoteText = quotePages.flatMap((page) => page.texts.map((item) => item.text));

for (const amount of [19753086420.0, 98765432101.23, 498765432.55]) {
  assert.ok(
    allQuoteText.includes(money(amount)),
    `la cifra ${money(amount)} debe aparecer completa en una sola línea`,
  );
}

assert.equal(allQuoteText.some((text) => text.includes("?")), false, "sin caracteres de reemplazo");

// Contenido largo: continúa en páginas adicionales sin truncarse.
const longObject = `${"Objeto contractual extenso con detalle técnico. ".repeat(900)}FIN-OBJETO`;
const longPages = inspectPdf(
  generateQuotePdf({
    quoteNumber: "COT-2026-2",
    version: 1,
    snapshot: buildSnapshot({
      objeto: longObject,
      amparos: [coverage("cumplimiento", 1000000, 2000)],
    }),
  }),
);
const longCheck = findOverflows(longPages, layout);

assert.ok(longPages.length >= 2, "el objeto largo debe continuar en otra página");
assert.deepEqual(longCheck.problems, []);
assert.ok(
  longPages.some((page) => page.texts.some((item) => item.text.includes("FIN-OBJETO"))),
  "el final del texto largo no debe truncarse",
);

// Muchos amparos: la tabla cruza páginas sin desbordes.
const manyPages = inspectPdf(
  generateQuotePdf({
    quoteNumber: "COT-2026-3",
    version: 1,
    snapshot: buildSnapshot({
      objeto: "Objeto",
      amparos: Array.from({ length: 60 }, (_, index) =>
        coverage(`Amparo adicional número ${index + 1} de nombre largo`, 1e9 + index, 1e6 + index),
      ),
    }),
  }),
);

assert.ok(manyPages.length >= 3);
assert.deepEqual(findOverflows(manyPages, layout).problems, []);

// PDF de otrosí: mismo motor de texto y celdas.
function amendmentRow(name, big) {
  return {
    tipo_amparo: name,
    nombre_amparo: name,
    es_rce: false,
    valor_asegurado_vigente: big,
    valor_asegurado_adicion: big / 10,
    valor_asegurado_acumulado: big * 1.1,
    fecha_desde: "2026-01-01",
    fecha_hasta_anterior: "2026-12-31",
    fecha_hasta: "2027-03-31",
    dias_vigencia_adicion: 454,
    dias_prorroga: 90,
    tasa_aplicada: 0.002,
    prima_valor_adicionado: big / 1000,
    prima_prorroga: big / 900,
    prima_neta: big / 500,
    iva: big / 2600,
    prima_total: big / 420,
    subamparos: [],
    observaciones: [],
  };
}

const amendmentSnapshot = {
  generado_en: "2026-10-01T10:00:00Z",
  numero_cotizacion: "AJ-COT-2026-1-OT1",
  version: 1,
  cliente: stress.cliente,
  contrato: stress.contrato,
  poliza_base: { id: 1, numero_cotizacion: "COT-2026-1", version: 1, fecha_emision: null },
  modificacion: {
    id: 1,
    secuencia: 1,
    numero_modificacion: "Otrosí No. 1",
    tipo_modificacion: "Adición y prórroga",
    fecha_firma: null,
    valor_contrato_anterior: 98765432100,
    valor_adicion: 12345678901,
    valor_contrato_acumulado: 111111111001,
    fecha_fin_anterior: "2026-12-31",
    nueva_fecha_fin: "2027-03-31",
    dias_prorroga: 90,
    objeto_nuevo: "Objeto ajustado. ".repeat(40),
    requiere_ajuste_garantias: true,
  },
  estado_vigente_anterior: {},
  liquidacion: {
    generado_en: "2026-10-01T10:00:00Z",
    moneda: "COP",
    valor_contrato_anterior: 1,
    valor_adicion: 1,
    valor_contrato_acumulado: 2,
    fecha_fin_anterior: "2026-12-31",
    nueva_fecha_fin: "2027-03-31",
    dias_prorroga: 90,
    rows: [amendmentRow("cumplimiento", 98765432101.23), amendmentRow("responsabilidad_civil_extracontractual", 5e9)],
    totales: { prima_valor_adicionado: 1, prima_prorroga: 1, prima_neta: 1, iva: 1, prima_total: 1 },
    alertas: [],
  },
  estado_vigente_resultante: {},
  observaciones: ["Cotización de ajuste sujeta a aprobación final de la aseguradora."],
  alertas: [],
};
const amendmentCheck = findOverflows(
  inspectPdf(generateAmendmentQuotePdf(amendmentSnapshot)),
  { pageWidth: 792, marginX: 32 },
);

assert.ok(amendmentCheck.checked > 20);
assert.deepEqual(amendmentCheck.problems, []);

console.log("Validaciones de PDF completadas.");
