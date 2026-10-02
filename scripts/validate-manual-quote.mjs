import assert from "node:assert/strict";
import { normalizeCoverage } from "../lib/coverage-calculations.ts";
import { getManualQuoteIssues } from "../lib/manual-quote.ts";
import { newQuoteSchema } from "../lib/schemas.ts";

const complete = {
  contratante: "Entidad contratante",
  valor_contrato: 1000000000,
  fecha_inicio: "2026-01-01",
  fecha_fin: "2026-12-31",
  objeto: "Objeto del contrato",
};

assert.deepEqual(getManualQuoteIssues(complete, 1), []);
assert.equal(getManualQuoteIssues(complete, 0).length, 1);
assert.equal(getManualQuoteIssues({ ...complete, contratante: " " }, 1).length, 1);
assert.equal(getManualQuoteIssues({ ...complete, valor_contrato: null }, 1).length, 1);
assert.equal(getManualQuoteIssues({ ...complete, objeto: null }, 1).length, 1);
assert.equal(getManualQuoteIssues({ ...complete, fecha_fin: null }, 1).length, 1);
assert.match(
  getManualQuoteIssues({ ...complete, fecha_fin: "2025-12-31" }, 1)[0],
  /posterior/,
);
assert.equal(
  getManualQuoteIssues({ contratante: null, valor_contrato: null, fecha_inicio: null, fecha_fin: null, objeto: null }, 0).length,
  5,
);

// El número de contrato es opcional.
const parsed = newQuoteSchema.parse({
  nombreCliente: "Tomador S.A.S.",
  nitCliente: "900123456",
  ejecutivo: "Carolina Barragán",
  contratante: "Entidad",
});

assert.equal(parsed.numero_contrato, null);
assert.throws(() =>
  newQuoteSchema.parse({ nombreCliente: "T", nitCliente: "9", ejecutivo: "Otra", contratante: "" }),
);

// Un amparo manual sin fuente ni confianza no genera motivos de extracción.
const coverage = {
  tipo_amparo: "Cumplimiento",
  porcentaje: 0.2,
  tipo_vigencia: "contractual",
  base_vigencia: "fecha_fin_contrato",
  fecha_desde: null,
  fecha_hasta: null,
  fuente_texto: null,
  fuente_pagina: null,
  confianza: "baja",
  tasa: 0.002,
};
const contractContext = {
  valorContrato: 1000000000,
  fechaInicio: "2026-01-01",
  fechaFin: "2026-12-31",
};
const manual = normalizeCoverage(coverage, { ...contractContext, origenManual: true });
const fromDocument = normalizeCoverage(coverage, contractContext);

assert.equal(manual.valor_asegurado, 200000000);
assert.equal(manual.requiere_revision, false);
assert.equal(fromDocument.requiere_revision, true);

console.log("Validaciones de cotización manual completadas.");
