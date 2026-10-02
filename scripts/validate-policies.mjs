import assert from "node:assert/strict";
import {
  classifyCoveragePolicy,
  isCivilLiabilityCoverage,
  isCivilLiabilityName,
} from "../lib/coverage-policy.ts";
import { normalizeCoverage } from "../lib/coverage-calculations.ts";
import { mapExtractionToCoverageRows } from "../lib/processing.ts";
import {
  applyPolicyStructure,
  buildQuoteSnapshot,
  groupQuoteCoveragesByPolicy,
} from "../lib/quotes.ts";
import { generateQuotePdf } from "../lib/quote-pdf.ts";
import { findOverflows, inspectPdf } from "./pdf-inspect.mjs";

// --- Clasificador único ---
for (const name of [
  "Responsabilidad Civil Extracontractual",
  "responsabilidad_civil_extracontractual",
  "RCE",
  "PLO",
  "Predios, labores y operaciones",
  "RC Patronal",
  "Contratistas y subcontratistas",
  "Vehículos propios y no propios",
  "RC Cruzada",
]) {
  assert.equal(isCivilLiabilityName(name), true, name);
  assert.equal(classifyCoveragePolicy(name), "responsabilidad_civil", name);
}

for (const name of [
  "Cumplimiento",
  "cumplimiento",
  "Salarios y prestaciones sociales",
  "Calidad del servicio",
  "buen_manejo_anticipo",
  "Accidentes personales",
  "Equipos y maquinaria",
  "Amparo sin clasificar",
]) {
  assert.equal(isCivilLiabilityName(name), false, name);
  assert.equal(classifyCoveragePolicy(name), "cumplimiento", name);
}

// Palabras sueltas del texto fuente no reclasifican un amparo conocido.
assert.equal(
  isCivilLiabilityCoverage(
    "Cumplimiento",
    "Cumplimiento del contrato, por ejemplo respecto de las operaciones y labores pactadas.",
  ),
  false,
);
assert.equal(
  isCivilLiabilityCoverage(
    "Cumplimiento",
    "Garantía única: cumplimiento y póliza de responsabilidad civil extracontractual.",
  ),
  false,
);
// El texto fuente solo decide cuando el nombre no identifica el amparo.
assert.equal(
  isCivilLiabilityCoverage(
    "Amparo sin clasificar",
    "Póliza de responsabilidad civil extracontractual por 300 SMMLV.",
  ),
  true,
);

// --- normalizeCoverage ya no convierte Cumplimiento en RCE ---
const context = {
  valorContrato: 1000000000,
  baseCalculoAmparos: 1000000000,
  fechaInicio: "2026-01-01",
  fechaFin: "2026-12-31",
};
const fixed = normalizeCoverage(
  {
    tipo_amparo: "cumplimiento",
    porcentaje: 0.2,
    tipo_vigencia: "contractual",
    base_vigencia: "fecha_fin_contrato",
    dias_adicionales: 90,
    fuente_texto:
      "Cumplimiento del contrato, por ejemplo respecto de las operaciones pactadas, 20% del valor.",
    fuente_pagina: 3,
    confianza: "alta",
  },
  context,
);

assert.equal(fixed.tipo_amparo, "cumplimiento");
assert.equal(fixed.valor_asegurado, 200000000);

const rce = normalizeCoverage(
  {
    tipo_amparo: "Responsabilidad civil extracontractual",
    cuantia_fija: 300000000,
    fuente_texto: "Responsabilidad civil extracontractual con cuantía de $300.000.000.",
    fuente_pagina: 4,
    confianza: "alta",
  },
  context,
);

assert.equal(rce.tipo_amparo, "responsabilidad_civil_extracontractual");

// --- Extracción: un amparo de cumplimiento con palabras de RC en la fuente no se absorbe ---
const baseCoverage = {
  porcentaje: null,
  cuantia_fija: null,
  valor_asegurado: null,
  tipo_vigencia: "contractual",
  base_vigencia: "fecha_fin_contrato",
  dias_adicionales: 30,
  fecha_desde: null,
  fecha_hasta: null,
  fuente_pagina: 2,
  confianza: "alta",
  subamparos: [],
};
const rows = mapExtractionToCoverageRows(
  {
    garantias: [
      {
        ...baseCoverage,
        tipo_amparo: "Cumplimiento",
        porcentaje: 0.2,
        fuente_texto:
          "Cumplimiento del contrato en las operaciones y labores a cargo del contratista, 20% del valor.",
      },
      {
        ...baseCoverage,
        tipo_amparo: "Responsabilidad civil extracontractual",
        cuantia_fija: 300000000,
        fuente_texto: "Responsabilidad civil extracontractual por $300.000.000.",
      },
    ],
  },
  {
    contratoId: 1,
    valorContrato: 1000000000,
    baseCalculoAmparos: 1000000000,
    fechaInicio: "2026-01-01",
    fechaFin: "2026-12-31",
  },
);

assert.deepEqual(
  rows.map((row) => row.tipo_amparo).sort(),
  ["Cumplimiento", "responsabilidad_civil_extracontractual"],
);

// --- Snapshot v2 y agrupación por póliza ---
function amparoRow(tipo, valor, neta, extra = {}) {
  return {
    id: 1,
    contrato_id: 1,
    modificacion_id: null,
    tipo_amparo: tipo,
    valor_asegurado: valor,
    valor_base_calculo: valor,
    modo_calculo: "porcentaje_valor_contrato",
    fecha_desde: "2026-01-01",
    fecha_hasta: "2027-01-30",
    dias_vigencia: 394,
    prima_neta: neta,
    impuesto: Math.round(neta * 19) / 100,
    prima_total: Math.round(neta * 119) / 100,
    tasa: 0.002,
    tasa_manual: false,
    subamparos: [],
    ...extra,
  };
}

const amparos = [
  amparoRow("cumplimiento", 200000000, 1000000),
  amparoRow("calidad_y_estabilidad_del_servicio", 100000000, 500000),
  amparoRow("responsabilidad_civil_extracontractual", 300000000, 800000, {
    subamparos: [
      { nombre: "PLO", incluido: true, calculable: true, porcentaje_sublimite: 1, valor_sublimite: 300000000 },
      { nombre: "RC Patronal", incluido: true, calculable: false, porcentaje_sublimite: 0.5, valor_sublimite: 150000000 },
    ],
  }),
];
const snapshot = buildQuoteSnapshot({
  contract: {
    id: 1, numero_contrato: "C-1", objeto: "Objeto", tipo_contrato: "estatal", valor_contrato: 1e9,
    base_calculo_amparos: 1e9, base_calculo_incluye_iva: false, moneda: "COP", fecha_inicio: "2026-01-01",
    fecha_fin: "2026-12-31", plazo: null, contratante: "Entidad", contratante_nit: null,
    contratista: "Contratista", contratista_nit: null,
  },
  client: { id: 1, nombre: "Tomador S.A.S.", nit: "900", ejecutivo: "Carolina Barragán" },
  amparos,
  generatedAt: "2026-10-01T10:00:00.000Z",
});

assert.equal(snapshot.schema_version, 2);
assert.deepEqual(
  snapshot.amparos.map((coverage) => coverage.poliza),
  ["cumplimiento", "cumplimiento", "responsabilidad_civil"],
);
assert.equal(snapshot.polizas.length, 2);
assert.equal(snapshot.polizas[0].totales.prima_neta, 1500000);
assert.equal(snapshot.polizas[1].totales.prima_neta, 800000);
// El total combinado se conserva solo por compatibilidad con cotizaciones.total_*.
assert.equal(snapshot.totales.prima_neta, 2300000);

// Un snapshot v1 (sin poliza por amparo) se agrupa igual.
const legacyCoverages = snapshot.amparos.map((coverage) => {
  const legacy = { ...coverage };

  delete legacy.poliza;

  return legacy;
});
const legacyGroups = groupQuoteCoveragesByPolicy(legacyCoverages);

assert.deepEqual(
  legacyGroups.map((group) => [group.poliza, group.totales.prima_neta]),
  [["cumplimiento", 1500000], ["responsabilidad_civil", 800000]],
);
assert.equal(applyPolicyStructure({ ...snapshot, amparos: legacyCoverages }).schema_version, 2);

// --- PDF: dos pólizas independientes, sin "Total general", subamparos dentro de RC ---
function pdfTexts(pdfSnapshot) {
  const pages = inspectPdf(generateQuotePdf({ quoteNumber: "COT-2026-1", version: 1, snapshot: pdfSnapshot }));

  return pages.flatMap((page, pageIndex) =>
    page.texts.map((item) => ({ ...item, pageIndex })),
  );
}

const texts = pdfTexts(snapshot);
const find = (value) => texts.find((item) => item.text.includes(value));

assert.ok(find("P\xd3LIZA DE CUMPLIMIENTO"));
assert.ok(find("P\xd3LIZA DE RESPONSABILIDAD CIVIL"));
assert.equal(texts.some((item) => /total general/i.test(item.text)), false);
assert.ok(find("Total p\xf3liza de cumplimiento"));
assert.ok(find("Total p\xf3liza de responsabilidad civil"));

const cumplimientoTitle = find("P\xd3LIZA DE CUMPLIMIENTO");
const civilTitle = find("P\xd3LIZA DE RESPONSABILIDAD CIVIL");
const calidad = find("Calidad y estabilidad");
const patronal = find("RC Patronal");
const civilTotal = find("Total p\xf3liza de responsabilidad civil");

assert.ok(cumplimientoTitle.y > civilTitle.y, "Cumplimiento va antes que RC");
assert.ok(calidad.y > civilTitle.y, "los amparos de cumplimiento quedan sobre la sección RC");
assert.ok(patronal.y < civilTitle.y && patronal.y > civilTotal.y, "subamparos dentro de la sección RC, antes de su total");
assert.ok(
  texts.filter((item) => item.text.includes("RC Patronal")).length === 1,
  "los subamparos de RC no se repiten como amparos",
);

// Una sola póliza: solo aparece su sección.
const onlyCumplimiento = pdfTexts(
  applyPolicyStructure({ ...snapshot, amparos: snapshot.amparos.filter((coverage) => coverage.poliza === "cumplimiento") }),
);

assert.equal(onlyCumplimiento.some((item) => item.text.includes("RESPONSABILIDAD CIVIL")), false);

// Un snapshot v1 emitido históricamente sigue generando el PDF nuevo.
assert.ok(
  pdfTexts({ ...snapshot, schema_version: undefined, polizas: undefined, amparos: legacyCoverages }).some((item) =>
    item.text.includes("P\xd3LIZA DE RESPONSABILIDAD CIVIL"),
  ),
);

// --- v0.5.1: subamparos como bloque compacto, resumen de primas, etiquetas ---
function money(value) {
  return `$ ${new Intl.NumberFormat("es-CO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`;
}

// Ya no existe la tabla independiente de subamparos (columnas antiguas).
assert.equal(texts.some((item) => item.text === "% sublímite"), false);
assert.equal(texts.some((item) => item.text === "Valor sublímite"), false);
assert.equal(texts.some((item) => item.text === "Subamparos incluidos"), false);

// El bloque compacto incluye nombre, porcentaje y valor de cada subamparo, con la nota debajo.
const compactBlock = find("Subamparos incluidos:");
assert.ok(compactBlock);
assert.ok(compactBlock.text.includes("PLO 100% ($ 300.000.000,00)"));
assert.ok(compactBlock.text.includes("RC Patronal 50% ($ 150.000.000,00)"));
assert.ok(
  find(
    "Los subamparos no generan prima individual; la prima corresponde a la cobertura principal RCE/PLO.",
  ),
);

// Resumen de primas: una fila por póliza, sin fila de total general.
assert.ok(find("Resumen de primas"));
assert.ok(texts.some((item) => item.text === "Cumplimiento"));
assert.ok(texts.some((item) => item.text === "Responsabilidad civil"));
assert.ok(find(money(snapshot.polizas[0].totales.prima_total)));
assert.ok(find(money(snapshot.polizas[1].totales.prima_total)));
assert.equal(texts.some((item) => /total general/i.test(item.text)), false);

// Etiquetas de información general: Cliente / Contratante / Contratista.
assert.ok(texts.some((item) => item.text === "Cliente"));
assert.ok(texts.some((item) => item.text === "Contratante"));
assert.ok(texts.some((item) => item.text === "Contratista"));
assert.equal(texts.some((item) => item.text === "Tomador"), false);
assert.equal(texts.some((item) => item.text === "Asegurado / contratante"), false);

// Varios subamparos deben hacer wrap en más de una línea, sin salirse de su celda ni del margen.
const manySubamparos = applyPolicyStructure({
  ...snapshot,
  amparos: [
    ...snapshot.amparos.filter((coverage) => coverage.poliza === "cumplimiento"),
    {
      ...snapshot.amparos.find((coverage) => coverage.poliza === "responsabilidad_civil"),
      subamparos: [
        { nombre: "PLO", incluido: true, calculable: true, porcentaje_sublimite: 1, valor_sublimite: 300000000 },
        { nombre: "Contratistas y subcontratistas", incluido: true, calculable: false, porcentaje_sublimite: 0.5, valor_sublimite: 150000000 },
        { nombre: "RC Patronal", incluido: true, calculable: false, porcentaje_sublimite: 0.5, valor_sublimite: 150000000 },
        { nombre: "RC Cruzada", incluido: true, calculable: false, porcentaje_sublimite: 0.5, valor_sublimite: 150000000 },
        { nombre: "Vehículos propios y no propios", incluido: true, calculable: false, porcentaje_sublimite: 0.5, valor_sublimite: 150000000 },
      ],
    },
  ],
});
const manyPages = inspectPdf(generateQuotePdf({ quoteNumber: "COT-2026-4", version: 1, snapshot: manySubamparos }));
const manyTexts = manyPages.flatMap((page) => page.texts);
const firstLine = manyTexts.find((item) => item.text.startsWith("Subamparos incluidos:"));
const lastLine = manyTexts.find((item) => item.text.includes("Veh\xedculos propios y no propios"));

assert.ok(firstLine);
assert.ok(lastLine);
assert.notEqual(firstLine.y, lastLine.y, "el bloque de subamparos debe ocupar más de una línea");
assert.deepEqual(findOverflows(manyPages, { pageWidth: 612, marginX: 36 }).problems, []);

console.log("Validaciones de pólizas completadas.");
