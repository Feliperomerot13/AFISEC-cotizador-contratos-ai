import assert from "node:assert/strict";
import { normalizeCoverage } from "../lib/coverage-calculations.ts";
import {
  getExtractionValue,
  normalizeBoolean,
  normalizeCurrency,
  normalizeDate,
  normalizeEnum,
  normalizeNumber,
} from "../lib/normalizers.ts";

assert.equal(normalizeCurrency(null), "COP");
assert.equal(normalizeCurrency("$"), "COP");
assert.equal(normalizeCurrency("pesos colombianos"), "COP");
assert.equal(normalizeCurrency("US dollars"), "USD");
assert.equal(normalizeBoolean({ valor: true }, false), true);
assert.equal(
  normalizeEnum({ valor: "particular", confianza: "alta" }, [
    "estatal",
    "particular",
  ], null),
  "particular",
);
assert.equal(
  getExtractionValue({ valor: "ABC", confianza: "alta", pagina: 1 }),
  "ABC",
);
assert.equal(normalizeDate("No especificado"), null);
assert.equal(normalizeDate(null), null);
assert.equal(normalizeDate("31/12/2026"), "2026-12-31");
assert.equal(normalizeDate("2026-99-99"), null);
assert.equal(normalizeNumber("$ 1.200.000.000"), 1200000000);
assert.equal(normalizeNumber("1,200,000,000"), 1200000000);
assert.equal(normalizeNumber("número inválido"), null);

const incompleteCoverage = normalizeCoverage(
  {
    tipo_amparo: "Cumplimiento",
    porcentaje: null,
    cuantia_fija: null,
    valor_asegurado: null,
    tipo_vigencia: "post_contractual",
    base_vigencia: "acta_recibo_final",
    dias_adicionales: null,
    fecha_desde: null,
    fecha_hasta: null,
    fuente_texto: "vigencia por definir",
    fuente_pagina: 12,
    confianza: "baja",
  },
  {
    valorContrato: 1200000000,
    fechaInicio: "2026-01-01",
    fechaFin: "2026-12-31",
  },
);

assert.equal(incompleteCoverage.valor_asegurado, null);
assert.equal(incompleteCoverage.fecha_hasta, null);
assert.equal(incompleteCoverage.requiere_revision, true);
assert.match(
  incompleteCoverage.motivo_revision ?? "",
  /acta de recibo final|Confianza baja|Falta porcentaje/,
);

const complianceCoverage = normalizeCoverage(
  {
    tipo_amparo: "Cumplimiento",
    porcentaje: 0.3,
    cuantia_fija: null,
    valor_asegurado: null,
    tipo_vigencia: "contractual",
    base_vigencia: "fecha_fin_contrato",
    dias_adicionales: 30,
    fecha_desde: null,
    fecha_hasta: null,
    fuente_texto: "Cumplimiento equivalente al treinta por ciento del contrato.",
    fuente_pagina: 10,
    confianza: "alta",
    tasa: 0.002,
    iva_porcentaje: 0.19,
  },
  {
    valorContrato: 2520269003,
    fechaInicio: "2024-02-02",
    fechaFin: "2025-02-02",
  },
);

assert.equal(complianceCoverage.valor_asegurado, 756080700.9);
assert.equal(complianceCoverage.fecha_desde, "2024-02-02");
assert.equal(complianceCoverage.fecha_hasta, "2025-03-04");
assert.equal(complianceCoverage.dias_adicionales, 30);
assert.equal(complianceCoverage.dias_vigencia, 396);
assert.equal(complianceCoverage.prima_neta, 1640591.55);
assert.equal(complianceCoverage.impuesto, 311712.39);
assert.equal(complianceCoverage.prima_total, 1952303.94);

const payrollCoverage = normalizeCoverage(
  {
    tipo_amparo: "Salarios y prestaciones sociales",
    porcentaje: 0.1,
    cuantia_fija: null,
    valor_asegurado: null,
    tipo_vigencia: "post_contractual",
    base_vigencia: "fecha_fin_contrato",
    dias_adicionales: null,
    fecha_desde: null,
    fecha_hasta: null,
    fuente_texto: "Salarios y prestaciones sociales por el plazo y tres años mas.",
    fuente_pagina: 10,
    confianza: "alta",
    tasa: 0.002,
  },
  {
    valorContrato: 2520269003,
    fechaInicio: "2024-02-02",
    fechaFin: "2025-02-02",
  },
);

assert.equal(payrollCoverage.valor_asegurado, 252026900.3);
assert.equal(payrollCoverage.fecha_desde, "2024-02-02");
assert.equal(payrollCoverage.dias_adicionales, 1095);

const civilLiabilityCoverage = normalizeCoverage(
  {
    tipo_amparo: "Responsabilidad Civil Extracontractual",
    porcentaje: null,
    cuantia_fija: 1000000000,
    valor_asegurado: null,
    tipo_vigencia: "contractual",
    base_vigencia: "fecha_fin_contrato",
    dias_adicionales: 30,
    fecha_desde: null,
    fecha_hasta: null,
    fuente_texto:
      "Póliza de Responsabilidad Civil Extracontractual. PLO tendrá un límite asegurado del 100% de lo exigido para esta póliza. Cuantía $1.000.000.000.",
    fuente_pagina: 11,
    confianza: "alta",
  },
  {
    valorContrato: 2520269003,
    fechaInicio: "2024-02-02",
    fechaFin: "2025-02-02",
  },
);

const plo = civilLiabilityCoverage.subamparos.find(
  (subamparo) => subamparo.nombre === "PLO",
);
const informationalSubcoverages = civilLiabilityCoverage.subamparos.filter(
  (subamparo) => subamparo.nombre !== "PLO",
);

assert.equal(
  civilLiabilityCoverage.tipo_amparo,
  "responsabilidad_civil_extracontractual",
);
assert.equal(civilLiabilityCoverage.modo_calculo, "cuantia_fija");
assert.equal(civilLiabilityCoverage.valor_asegurado, 1000000000);
assert.equal(civilLiabilityCoverage.tasa, 0.0025);
assert.equal(civilLiabilityCoverage.fecha_desde, "2024-02-02");
assert.equal(civilLiabilityCoverage.fecha_hasta, "2025-03-04");
assert.equal(civilLiabilityCoverage.dias_vigencia, 396);
assert.equal(civilLiabilityCoverage.prima_neta, 2712328.77);
assert.equal(civilLiabilityCoverage.prima_total, 3227671.24);
assert.equal(civilLiabilityCoverage.subamparos.length, 5);
assert.equal(plo?.calculable, true);
assert.equal(plo?.origen, "contrato");
assert.equal(plo?.porcentaje_sublimite, 1);
assert.equal(plo?.valor_sublimite, 1000000000);
informationalSubcoverages.forEach((subamparo) => {
  assert.equal(subamparo.calculable, false);
  assert.equal(subamparo.origen, "regla_plantilla_afisec");
  assert.equal(subamparo.valor_sublimite, 500000000);
  assert.equal(subamparo.requiere_revision, true);
});

console.info("Validaciones de normalización completadas.");
