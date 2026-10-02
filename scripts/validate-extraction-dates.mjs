import assert from "node:assert/strict";
import { repairExtractionDates } from "../lib/ai.ts";
import {
  applyDeterministicContractFallbacksForTest,
  mapExtractionToCoverageRows,
} from "../lib/processing.ts";
import { aiExtractionSchema } from "../lib/schemas.ts";
import { parseSpanishDate } from "../lib/spanish-dates.ts";

// --- Formatos de fecha que antes no se reconocían ---
const dateCases = {
  "suscrito el 2 de marzo de 2026": "2026-03-02",
  "lunes 2 de marzo de 2026": "2026-03-02",
  "Lunes, 2 de Marzo del 2026": "2026-03-02",
  "el día dos (2) de marzo de 2026": "2026-03-02",
  "2 de marzo del 2026": "2026-03-02",
  "2 de marzo, 2026": "2026-03-02",
  "1° de marzo de 2026": "2026-03-01",
  "primero de marzo de 2026": "2026-03-01",
  "02-03-2026": "2026-03-02",
  "02.03.2026": "2026-03-02",
  "02/03/2026": "2026-03-02",
  "2/3/26": "2026-03-02",
  "2026-03-02": "2026-03-02",
  "Bogotá D.C., a los 2 días del mes de marzo de 2026": "2026-03-02",
  "2 de marzo de dos mil veintiséis": "2026-03-02",
  "dos (2) de marzo de dos mil veintiséis (2026)": "2026-03-02",
  "2 de septiembre de 2026": "2026-09-02",
  "15 de ene. de 2027": "2027-01-15",
  "2 de MARZO de 2026": "2026-03-02",
};

for (const [text, expected] of Object.entries(dateCases)) {
  assert.equal(parseSpanishDate(text), expected, text);
}

assert.equal(parseSpanishDate("31 de febrero de 2026"), null);
assert.equal(parseSpanishDate("sin fecha alguna"), null);
assert.equal(parseSpanishDate("Valor de $1.234.567,00"), null);
assert.equal(
  parseSpanishDate("firmado el 5 de abril de 2026 y vigente desde el 10 de abril de 2026"),
  "2026-04-05",
);

// --- Reparación de fechas devueltas por el modelo, sin tocar textos ---
const repaired = repairExtractionDates({
  fecha_inicio: { valor: "lunes 2 de marzo de 2026", confianza: "alta" },
  fecha_fin: { valor: "no se especifica", confianza: "baja" },
  plazo: { valor: "un año desde el 2 de marzo de 2026", confianza: "alta" },
  garantias: [{ fecha_desde: "2 de marzo del 2026", fecha_hasta: "2027-03-02" }],
});

assert.equal(repaired.fecha_inicio.valor, "2026-03-02");
assert.equal(repaired.fecha_fin.valor, null);
assert.equal(repaired.plazo.valor, "un año desde el 2 de marzo de 2026");
assert.equal(repaired.garantias[0].fecha_desde, "2026-03-02");
assert.equal(repaired.garantias[0].fecha_hasta, "2027-03-02");

// --- Fallback de plazo: meses con fin de mes y plazo de pago ignorado ---
function sourced(valor = null) {
  return { valor, confianza: "baja", pagina: null, fuente: null };
}

const extraction = aiExtractionSchema.parse({
  numero_contrato: sourced(),
  tipo_contrato: sourced(),
  contratante: { nombre: null, nit: null, confianza: "baja", pagina: null, fuente: null },
  contratista: { nombre: null, nit: null, confianza: "baja", pagina: null, fuente: null },
  objeto: sourced(),
  valor_contrato: { valor_numerico: null, moneda: null, confianza: "baja", pagina: null, fuente: null },
  fecha_inicio: sourced(),
  fecha_fin: sourced(),
  plazo: sourced(),
  garantias: [],
  campos_no_encontrados: [],
  alertas: [],
});
const withDates = applyDeterministicContractFallbacksForTest(
  extraction,
  "--- Página 1 ---\nEl plazo de ejecución será de seis (6) meses contados a partir de la suscripción el 31 de agosto del 2026. El pago se hará a 30 días.",
);

assert.equal(withDates.fecha_inicio.valor, "2026-08-31");
assert.equal(withDates.fecha_fin.valor, "2027-02-28");

// --- Periodo adicional entregado por el modelo ---
const baseCoverage = {
  tipo_amparo: "Cumplimiento",
  porcentaje: 0.2,
  cuantia_fija: null,
  valor_asegurado: null,
  tipo_vigencia: "contractual",
  base_vigencia: "fecha_fin_contrato",
  dias_adicionales: 0,
  fecha_desde: null,
  fecha_hasta: null,
  fuente_texto: "Vigencia igual al plazo del contrato y dos meses más.",
  fuente_pagina: 3,
  confianza: "alta",
  subamparos: [],
};
const contract = {
  contratoId: 1,
  valorContrato: 1000000000,
  baseCalculoAmparos: 1000000000,
  fechaInicio: "2026-01-01",
  fechaFin: "2026-12-31",
};
const [withPeriod] = mapExtractionToCoverageRows(
  { garantias: [{ ...baseCoverage, periodo_adicional: { cantidad: 2, unidad: "meses" } }] },
  contract,
);

assert.equal(withPeriod.periodo_adicional_cantidad, 2);
assert.equal(withPeriod.periodo_adicional_unidad, "meses");
assert.equal(withPeriod.fecha_hasta, "2027-02-28");

// Si el modelo omite el periodo (0 o sin unidad), se lee del texto de la cláusula y queda para revisión.
for (const periodo_adicional of [{ cantidad: 0, unidad: null }, { cantidad: null, unidad: null }, undefined]) {
  const [fromText] = mapExtractionToCoverageRows(
    { garantias: [{ ...baseCoverage, periodo_adicional }] },
    contract,
  );

  assert.equal(fromText.fecha_hasta, "2027-02-28");
  assert.equal(fromText.periodo_adicional_unidad, "meses");
}

console.log("Validaciones de extracción de fechas completadas.");
