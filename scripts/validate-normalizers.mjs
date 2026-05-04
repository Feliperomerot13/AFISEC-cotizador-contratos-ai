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

const serviceQualityCoverage = normalizeCoverage(
  {
    tipo_amparo: "Calidad del servicio",
    porcentaje: 0.05,
    cuantia_fija: null,
    valor_asegurado: null,
    tipo_vigencia: "post_contractual",
    base_vigencia: "acta_recibo_final",
    dias_adicionales: null,
    fecha_desde: null,
    fecha_hasta: null,
    fuente_texto: "Calidad del servicio por definir.",
    fuente_pagina: 12,
    confianza: "baja",
    tasa: 0.002,
  },
  {
    valorContrato: 1200000000,
    fechaInicio: "2026-01-01",
    fechaFin: "2026-12-31",
  },
);

assert.equal(serviceQualityCoverage.base_vigencia, "acta_recibo_final");
assert.equal(serviceQualityCoverage.valor_asegurado, 60000000);
assert.equal(serviceQualityCoverage.fecha_desde, "2026-12-31");
assert.equal(serviceQualityCoverage.fecha_hasta, "2028-01-29");
assert.equal(serviceQualityCoverage.dias_adicionales, 30);
assert.equal(serviceQualityCoverage.dias_vigencia, 394);
assert.equal(serviceQualityCoverage.prima_neta, 129534.25);
assert.equal(serviceQualityCoverage.impuesto, 24611.51);
assert.equal(serviceQualityCoverage.prima_total, 154145.76);
assert.equal(serviceQualityCoverage.requiere_revision, true);
assert.match(
  serviceQualityCoverage.motivo_revision ?? "",
  /La fecha del Acta de Recibo Final no está disponible|Confianza baja/,
);

const complianceCoverage = normalizeCoverage(
  {
    tipo_amparo: "Cumplimiento",
    porcentaje: 0.3,
    cuantia_fija: null,
    valor_asegurado: null,
    tipo_vigencia: "contractual",
    base_vigencia: "otra",
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
assert.equal(complianceCoverage.base_vigencia, "fecha_fin_contrato");
assert.equal(complianceCoverage.fecha_desde, "2024-02-02");
assert.equal(complianceCoverage.fecha_hasta, "2025-03-04");
assert.equal(complianceCoverage.dias_adicionales, 30);
assert.equal(complianceCoverage.dias_vigencia, 396);
assert.equal(complianceCoverage.prima_neta, 1640591.55);
assert.equal(complianceCoverage.impuesto, 311712.39);
assert.equal(complianceCoverage.prima_total, 1952303.94);

const explicitValidityCoverage = normalizeCoverage(
  {
    tipo_amparo: "Gastos médicos y auxilio funerario",
    porcentaje: 0.05,
    cuantia_fija: null,
    valor_asegurado: null,
    tipo_vigencia: "contractual",
    base_vigencia: "otra",
    dias_adicionales: null,
    fecha_desde: "2024-02-10",
    fecha_hasta: "2024-02-12",
    fuente_texto:
      "La cobertura tiene vigencia explícita del 10 de febrero de 2024 al 12 de febrero de 2024.",
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

assert.equal(explicitValidityCoverage.base_vigencia, "fecha_explicita");
assert.equal(explicitValidityCoverage.fecha_desde, "2024-02-10");
assert.equal(explicitValidityCoverage.fecha_hasta, "2024-02-12");

const undeterminedCoverage = normalizeCoverage(
  {
    tipo_amparo: "Garantía no identificada",
    porcentaje: null,
    cuantia_fija: null,
    valor_asegurado: null,
    tipo_vigencia: null,
    base_vigencia: "otra",
    dias_adicionales: null,
    fecha_desde: null,
    fecha_hasta: null,
    fuente_texto: "Garantía por definir sin fecha ni base suficiente.",
    fuente_pagina: 12,
    confianza: "baja",
  },
  {
    valorContrato: 2520269003,
    fechaInicio: "2024-02-02",
    fechaFin: "2025-02-02",
  },
);

assert.equal(undeterminedCoverage.base_vigencia, "no_determinada");
assert.equal(undeterminedCoverage.requiere_revision, true);
assert.match(
  undeterminedCoverage.motivo_revision ?? "",
  /No se pudo determinar la base de vigencia|Confianza baja/,
);

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
