import assert from "node:assert/strict";
import { normalizeCoverage } from "../lib/coverage-calculations.ts";
import { formatDate } from "../lib/format.ts";
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
assert.match(formatDate("2026-12-25"), /25/);

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
    fuente_texto:
      "Calidad y estabilidad del servicio con una vigencia de un (1) año contado a partir del Acta de Recibo Final.",
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
assert.equal(serviceQualityCoverage.fecha_hasta, "2027-12-31");
assert.equal(serviceQualityCoverage.dias_adicionales, 365);
assert.equal(serviceQualityCoverage.dias_vigencia, 365);
assert.equal(serviceQualityCoverage.prima_neta, 120000);
assert.equal(serviceQualityCoverage.impuesto, 22800);
assert.equal(serviceQualityCoverage.prima_total, 142800);
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

const changedAdditionalDaysCoverage = normalizeCoverage(
  {
    tipo_amparo: "Cumplimiento",
    porcentaje: 0.3,
    cuantia_fija: null,
    valor_asegurado: null,
    tipo_vigencia: "contractual",
    base_vigencia: "fecha_fin_contrato",
    dias_adicionales: 60,
    fecha_desde: null,
    fecha_hasta: null,
    fuente_texto: "Cumplimiento equivalente al treinta por ciento del contrato.",
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

assert.equal(changedAdditionalDaysCoverage.fecha_hasta, "2025-04-03");
assert.equal(changedAdditionalDaysCoverage.dias_vigencia, 426);

const confirmedBaseCoverage = normalizeCoverage(
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
  },
  {
    valorContrato: 2000,
    baseCalculoAmparos: 1000,
    fechaInicio: "2024-01-01",
    fechaFin: "2024-12-31",
  },
);

assert.equal(confirmedBaseCoverage.valor_base_calculo, 1000);
assert.equal(confirmedBaseCoverage.valor_asegurado, 300);

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
  assert.equal(subamparo.incluido, true);
  assert.equal(subamparo.origen, "regla_plantilla_afisec");
  assert.equal(subamparo.valor_sublimite, 500000000);
  assert.equal(subamparo.requiere_revision, true);
});

const civilLiabilityContractSublimit = normalizeCoverage(
  {
    tipo_amparo: "Responsabilidad Civil Extracontractual",
    porcentaje: null,
    cuantia_fija: 300000000,
    valor_asegurado: null,
    tipo_vigencia: "contractual",
    base_vigencia: "fecha_fin_contrato",
    dias_adicionales: 30,
    fecha_desde: null,
    fecha_hasta: null,
    fuente_texto:
      "La póliza de Responsabilidad Civil Extracontractual tendrá PLO de $300.000.000. Cada uno de estos amparos deberá tener una cuantía por evento mínimo del treinta por ciento (30%) del PLO.",
    fuente_pagina: 9,
    confianza: "alta",
  },
  {
    valorContrato: 246038271,
    fechaInicio: "2026-01-01",
    fechaFin: "2026-08-29",
  },
);

const patronal = civilLiabilityContractSublimit.subamparos.find(
  (subamparo) => subamparo.nombre === "RC Patronal",
);

assert.equal(patronal?.calculable, false);
assert.equal(patronal?.porcentaje_sublimite, 0.3);
assert.equal(patronal?.valor_sublimite, 90000000);
assert.equal(patronal?.origen, "contrato");
assert.equal(patronal?.requiere_revision, false);

const advanceCoverage = normalizeCoverage(
  {
    tipo_amparo: "Buen manejo y correcta inversión del anticipo",
    porcentaje: 1,
    cuantia_fija: null,
    valor_asegurado: null,
    valor_anticipo: 41350970,
    porcentaje_anticipo: 0.2,
    anticipo_base_incluye_iva: false,
    tipo_vigencia: "contractual",
    base_vigencia: "fecha_fin_contrato",
    dias_adicionales: 30,
    fecha_desde: null,
    fecha_hasta: null,
    fuente_texto:
      "Anticipo del veinte por ciento (20%) del valor estimado sin incluir IVA. Buen manejo del anticipo por el 100% de la suma entregada.",
    fuente_pagina: 8,
    confianza: "alta",
    tasa: 0.002,
  },
  {
    valorContrato: 246038271,
    baseCalculoAmparos: 206754850,
    fechaInicio: "2026-01-01",
    fechaFin: "2026-08-29",
  },
);

assert.equal(advanceCoverage.tipo_amparo, "buen_manejo_anticipo");
assert.equal(advanceCoverage.modo_calculo, "anticipo_100");
assert.equal(advanceCoverage.porcentaje, 0.2);
assert.equal(advanceCoverage.valor_base_calculo, 206754850);
assert.equal(advanceCoverage.valor_asegurado, 41350970);
assert.equal(advanceCoverage.requiere_revision, false);

const derivedAdvanceCoverage = normalizeCoverage(
  {
    tipo_amparo: "Buen manejo de anticipo",
    porcentaje: 1,
    cuantia_fija: null,
    valor_asegurado: 206754850,
    valor_base_calculo: 206754850,
    tipo_vigencia: "contractual",
    base_vigencia: "fecha_fin_contrato",
    dias_adicionales: 30,
    fecha_desde: null,
    fecha_hasta: null,
    fuente_texto:
      "Valor estimado del contrato sin incluir IVA: $206.754.850. Anticipo del veinte por ciento (20%) del valor estimado sin incluir IVA. Buen manejo del anticipo por el 100% de la suma entregada.",
    fuente_pagina: 8,
    confianza: "alta",
    tasa: 0.002,
  },
  {
    valorContrato: 246038271,
    baseCalculoAmparos: 246038271,
    fechaInicio: "2026-01-01",
    fechaFin: "2026-08-29",
  },
);

assert.equal(derivedAdvanceCoverage.porcentaje, 0.2);
assert.equal(derivedAdvanceCoverage.valor_base_calculo, 206754850);
assert.equal(derivedAdvanceCoverage.valor_asegurado, 41350970);
assert.equal(derivedAdvanceCoverage.modo_calculo, "anticipo_100");

const civilLiabilityNamedPlo = normalizeCoverage(
  {
    tipo_amparo: "Responsabilidad Civil Extracontractual",
    porcentaje: null,
    cuantia_fija: 300000000,
    valor_asegurado: null,
    tipo_vigencia: "contractual",
    base_vigencia: "fecha_fin_contrato",
    dias_adicionales: 30,
    fecha_desde: null,
    fecha_hasta: null,
    fuente_texto:
      "Predios, labores y operaciones. Cada uno de estos amparos deberá tener cuantía mínima del treinta por ciento (30%) del PLO.",
    fuente_pagina: 9,
    confianza: "alta",
    subamparos: [
      {
        nombre: "Predios, labores y operaciones",
        incluido: true,
        porcentaje_sublimite: 1,
        valor_sublimite: 300000000,
        origen: "contrato",
        calculable: false,
        requiere_revision: false,
        fuente_texto: "Predios, labores y operaciones.",
        fuente_pagina: 9,
      },
      {
        nombre: "RC Patronal",
        incluido: true,
        porcentaje_sublimite: 0.3,
        valor_sublimite: null,
        origen: "contrato",
        calculable: false,
        requiere_revision: false,
        fuente_texto:
          "Cada uno de estos amparos deberá tener cuantía mínima del treinta por ciento (30%) del PLO.",
        fuente_pagina: 9,
      },
    ],
  },
  {
    valorContrato: 246038271,
    fechaInicio: "2026-01-01",
    fechaFin: "2026-08-29",
  },
);

const normalizedPlo = civilLiabilityNamedPlo.subamparos.find(
  (subamparo) => subamparo.nombre === "PLO",
);
const normalizedPatronal = civilLiabilityNamedPlo.subamparos.find(
  (subamparo) => subamparo.nombre === "RC Patronal",
);

assert.equal(normalizedPlo?.calculable, true);
assert.equal(normalizedPlo?.valor_sublimite, 300000000);
assert.equal(normalizedPatronal?.calculable, false);
assert.equal(normalizedPatronal?.valor_sublimite, 90000000);

const civilLiabilityDeduped = normalizeCoverage(
  {
    tipo_amparo: "Responsabilidad Civil Extracontractual",
    porcentaje: null,
    cuantia_fija: 300000000,
    valor_asegurado: null,
    tipo_vigencia: "contractual",
    base_vigencia: "fecha_fin_contrato",
    dias_adicionales: 30,
    fecha_desde: null,
    fecha_hasta: null,
    fuente_texto:
      "PÓLIZA DE RESPONSABILIDAD CIVIL EXTRACONTRACTUAL. Cuantía $300.000.000 por evento. Cada uno de estos amparos deberá tener una cuantía por evento mínimo del 30% del PLO.",
    fuente_pagina: 9,
    confianza: "alta",
    subamparos: [
      {
        nombre: "Daño emergente y lucro cesante",
        incluido: true,
        porcentaje_sublimite: 0.3,
        valor_sublimite: 90000000,
        origen: "contrato",
        calculable: false,
        requiere_revision: false,
        fuente_texto: "Daño emergente y lucro cesante.",
        fuente_pagina: 9,
      },
      {
        nombre: "Cobertura expresa de daño emergente y lucro cesante",
        incluido: true,
        porcentaje_sublimite: 0.3,
        valor_sublimite: 90000000,
        origen: "contrato",
        calculable: false,
        requiere_revision: false,
        fuente_texto: "Cobertura expresa de daño emergente y lucro cesante.",
        fuente_pagina: 9,
      },
      {
        nombre: "Perjuicios extrapatrimoniales",
        incluido: true,
        porcentaje_sublimite: 0.3,
        valor_sublimite: 90000000,
        origen: "contrato",
        calculable: false,
        requiere_revision: false,
        fuente_texto: "Perjuicios extrapatrimoniales.",
        fuente_pagina: 9,
      },
      {
        nombre: "Cobertura expresa de perjuicios extrapatrimoniales",
        incluido: true,
        porcentaje_sublimite: 0.3,
        valor_sublimite: 90000000,
        origen: "contrato",
        calculable: false,
        requiere_revision: false,
        fuente_texto: "Cobertura expresa de perjuicios extrapatrimoniales.",
        fuente_pagina: 9,
      },
    ],
  },
  {
    valorContrato: 246038271,
    fechaInicio: "2026-04-29",
    fechaFin: "2026-12-25",
  },
);

assert.equal(
  civilLiabilityDeduped.subamparos.filter((subamparo) =>
    subamparo.nombre.toLowerCase().includes("lucro cesante"),
  ).length,
  1,
);
assert.equal(
  civilLiabilityDeduped.subamparos.filter((subamparo) =>
    subamparo.nombre.toLowerCase().includes("extrapatrimonial"),
  ).length,
  1,
);

const contract011Compliance = normalizeCoverage(
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
    fuente_texto: "Cumplimiento equivalente al treinta por ciento (30%) del contrato.",
    fuente_pagina: 9,
    confianza: "alta",
    tasa: null,
  },
  {
    valorContrato: 246038271,
    fechaInicio: "2026-04-29",
    fechaFin: "2026-12-25",
  },
);

assert.equal(contract011Compliance.valor_base_calculo, 246038271);
assert.equal(contract011Compliance.valor_asegurado, 73811481.3);
assert.equal(contract011Compliance.tasa, 0.002);
assert.equal(contract011Compliance.fecha_hasta, "2027-01-24");

const contract011Quality = normalizeCoverage(
  {
    tipo_amparo: "Calidad y estabilidad del servicio",
    porcentaje: 0.2,
    cuantia_fija: null,
    valor_asegurado: null,
    tipo_vigencia: "post_contractual",
    base_vigencia: "acta_recibo_final",
    dias_adicionales: null,
    fecha_desde: null,
    fecha_hasta: null,
    fuente_texto:
      "Calidad y estabilidad con una vigencia de un (1) año contado a partir del Acta de Recibo Final.",
    fuente_pagina: 9,
    confianza: "alta",
    tasa: null,
  },
  {
    valorContrato: 246038271,
    fechaInicio: "2026-04-29",
    fechaFin: "2026-12-25",
  },
);

assert.equal(contract011Quality.valor_base_calculo, 246038271);
assert.equal(contract011Quality.valor_asegurado, 49207654.2);
assert.equal(contract011Quality.fecha_desde, "2026-12-25");
assert.equal(contract011Quality.fecha_hasta, "2027-12-25");
assert.equal(contract011Quality.dias_vigencia, 365);
assert.equal(contract011Quality.requiere_revision, true);

console.info("Validaciones de normalización completadas.");
