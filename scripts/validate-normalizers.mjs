import assert from "node:assert/strict";
import {
  calculateAmendmentLiquidation,
  calculateAmendmentTotalsByBlock,
} from "../lib/amendments.ts";
import { inspectPdfPageCount } from "../lib/ai.ts";
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
import {
  applyDeterministicAmendmentFallbacksForTest,
  applyDeterministicContractFallbacksForTest,
  evaluateDocumentIntelligencePageCoverage,
  mapExtractionToContractUpdate,
} from "../lib/processing.ts";
import {
  aiExtractionSchema,
  amendmentExtractionSchema,
  deleteContractSchema,
} from "../lib/schemas.ts";

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
assert.deepEqual(deleteContractSchema.parse({ confirmacion: "ELIMINAR" }), {
  confirmacion: "ELIMINAR",
});
assert.throws(() =>
  deleteContractSchema.parse({ confirmacion: "eliminar" }),
);

const syntheticPdfWithReliableCount = new TextEncoder().encode(
  [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Count 21 /Kids [] >> endobj",
    ...Array.from(
      { length: 31 },
      (_, index) =>
        `${index + 10} 0 obj << /Type /Page /Parent 2 0 R >> endobj`,
    ),
  ].join("\n"),
).buffer;
const reliablePageCount = inspectPdfPageCount(
  syntheticPdfWithReliableCount,
);
assert.deepEqual(reliablePageCount, {
  pageCount: 21,
  reliable: true,
  source: "catalog",
});
assert.equal(
  evaluateDocumentIntelligencePageCoverage({
    pageCountAssessment: reliablePageCount,
    extractedPageCount: 21,
  }).shouldBlock,
  false,
);

const fragilePdfEstimate = new TextEncoder().encode(
  Array.from(
    { length: 31 },
    (_, index) => `${index + 1} 0 obj << /Type /Page >> endobj`,
  ).join("\n"),
).buffer;
const fragilePageCount = inspectPdfPageCount(fragilePdfEstimate);
assert.deepEqual(fragilePageCount, {
  pageCount: 31,
  reliable: false,
  source: "page_objects",
});
assert.equal(
  evaluateDocumentIntelligencePageCoverage({
    pageCountAssessment: fragilePageCount,
    extractedPageCount: 21,
  }).shouldBlock,
  false,
);
assert.equal(
  evaluateDocumentIntelligencePageCoverage({
    pageCountAssessment: {
      pageCount: 31,
      reliable: true,
      source: "catalog",
    },
    extractedPageCount: 21,
  }).shouldBlock,
  true,
);

const monthlyContractUpdate = mapExtractionToContractUpdate(
  buildContractExtraction({
    valor_contrato: {
      valor_numerico: 56100000,
      moneda: "COP",
      confianza: "media",
      pagina: 3,
      fuente: "Valor mensual de $56.100.000.",
    },
    valor_unitario_periodico: sourcedNumber(56100000),
    periodicidad_valor: sourcedValue("mensual"),
    numero_periodos: sourcedInteger(12),
    explicacion_calculo_valor: sourcedValue(
      "Valor mensual de $56.100.000 por doce meses.",
    ),
  }),
);
assert.equal(monthlyContractUpdate.valor_contrato, 673200000);
assert.equal(monthlyContractUpdate.base_calculo_amparos, 673200000);

const monthlyContractFallback = applyDeterministicContractFallbacksForTest(
  buildContractExtraction({
    valor_contrato: {
      valor_numerico: 56100000,
      moneda: "COP",
      confianza: "media",
      pagina: 3,
      fuente: "Valor mensual de $56.100.000.",
    },
  }),
  [
    "--- Página 1 ---",
    "El valor mensual del servicio será de $56.100.000.",
    "La duración del contrato será de doce meses.",
  ].join("\n"),
);
assert.equal(monthlyContractFallback.valor_contrato.valor_numerico, 673200000);
assert.equal(monthlyContractFallback.numero_periodos.valor, 12);

const actaInicioFallback = applyDeterministicContractFallbacksForTest(
  buildContractExtraction({
    fecha_inicio: sourcedDate(null),
    fecha_fin: sourcedDate(null),
    plazo: sourcedValue(null),
  }),
  [
    "--- Página 1 ---",
    "El contrato se suscribe el 15 de enero de 2026.",
    "El plazo de ejecución será de doscientos cuarenta (240) días contados a partir de la suscripción del Acta de Inicio.",
  ].join("\n"),
);
assert.equal(actaInicioFallback.fecha_inicio.valor, "2026-01-15");
assert.equal(actaInicioFallback.fecha_fin.valor, "2026-09-12");
assert.match(
  actaInicioFallback.alertas.join(" "),
  /Acta de Inicio.*fecha de firma\/perfeccionamiento/,
);

const amendmentOneExtraction = applyDeterministicAmendmentFallbacksForTest(
  buildAmendmentExtraction(),
  [
    "Otrosí No. 1.",
    "Se adiciona al contrato el valor mensual de $203.093.584 para el mes de febrero de 2025.",
    "El plazo se prorroga desde el 02 de febrero de 2025 hasta el 02 de marzo de 2025.",
  ].join(" "),
);

assert.equal(amendmentOneExtraction.valor_adicion.valor, 203093584);
assert.equal(amendmentOneExtraction.valor_adicion_total.valor, 203093584);
assert.equal(amendmentOneExtraction.requiere_multiplicacion.valor, false);

const amendmentTwoExtraction = applyDeterministicAmendmentFallbacksForTest(
  buildAmendmentExtraction(),
  [
    "Otrosí No. 2.",
    "Se adiciona al contrato el valor mensual de $203.093.584 para el mes de marzo de 2025.",
    "El plazo se prorroga desde el 02 de marzo de 2025 hasta el 02 de abril de 2025.",
  ].join(" "),
);

assert.equal(amendmentTwoExtraction.valor_adicion.valor, 203093584);
assert.equal(amendmentTwoExtraction.valor_adicion_total.valor, 203093584);
assert.equal(amendmentTwoExtraction.requiere_multiplicacion.valor, false);

const amendmentThreeExtraction = applyDeterministicAmendmentFallbacksForTest(
  buildAmendmentExtraction({
    valor_contrato_acumulado: sourcedNumber(3129549755),
  }),
  [
    "Otrosí No. 3.",
    "Se adiciona al contrato una tarifa mensual de $203.093.584 para los meses de abril y mayo de 2025.",
    "El plazo se prorroga desde el 02 de abril de 2025 hasta el 02 de junio de 2025.",
    "El impuesto de timbre se informa como obligación tributaria.",
  ].join(" "),
);

assert.equal(amendmentThreeExtraction.valor_adicion_unitario.valor, 203093584);
assert.equal(amendmentThreeExtraction.numero_periodos_adicionados.valor, 2);
assert.deepEqual(amendmentThreeExtraction.periodos_adicionados, [
  "abril",
  "mayo 2025",
]);
assert.equal(amendmentThreeExtraction.valor_adicion.valor, 406187168);
assert.equal(amendmentThreeExtraction.valor_adicion_total.valor, 406187168);
assert.equal(amendmentThreeExtraction.requiere_multiplicacion.valor, true);

const amendmentThreeLiquidation = calculateAmendmentLiquidation({
  activeState: {
    fuente: {
      tipo: "endoso",
      id: 2,
      numero: "AJ-COT-2026-1-OT2",
      version: 1,
    },
    cliente: {
      id: 1,
      nombre: "FERTOBRA S.A.S.",
      nit: "Sin dato",
      ejecutivo: "Carolina Barragán",
    },
    contrato: {
      id: 1,
      numero_contrato: "004 DE 2024",
      objeto: "Servicio de grúa",
      tipo_contrato: "estatal",
      valor_contrato: 2926456171,
      base_calculo_amparos: 2926456171,
      base_calculo_incluye_iva: true,
      moneda: "COP",
      fecha_inicio: "2024-02-02",
      fecha_fin: "2025-04-02",
      plazo: null,
      contratante: null,
      contratante_nit: null,
      contratista: null,
      contratista_nit: null,
    },
    amparos: [
      buildActiveCoverage({
        tipo_amparo: "cumplimiento",
        porcentaje: 0.3,
        valor_asegurado: 877936851,
        fecha_hasta: "2025-05-02",
      }),
      buildActiveCoverage({
        tipo_amparo: "calidad_del_servicio",
        porcentaje: 0.3,
        valor_asegurado: 877936851,
        fecha_hasta: "2025-05-02",
      }),
      buildActiveCoverage({
        tipo_amparo: "salarios_y_prestaciones_sociales",
        porcentaje: 0.1,
        valor_asegurado: 292645617,
        fecha_hasta: "2028-04-02",
      }),
      buildActiveCoverage({
        tipo_amparo: "responsabilidad_civil_extracontractual",
        porcentaje: null,
        valor_asegurado: 1000000000,
        fecha_hasta: "2025-05-02",
        tasa: 0.0025,
      }),
    ],
  },
  modification: {
    valor_contrato_anterior: 2926456171,
    valor_adicion: 406187168,
    valor_contrato_acumulado: 3332643339,
    fecha_desde: "2025-04-02",
    fecha_hasta: "2025-06-02",
    dias_prorroga: 61,
  },
  generatedAt: "2026-05-27T00:00:00.000Z",
});
const amendmentThreeCompliance = amendmentThreeLiquidation.rows.find(
  (row) => row.tipo_amparo === "cumplimiento",
);
const amendmentThreeQuality = amendmentThreeLiquidation.rows.find(
  (row) => row.tipo_amparo === "calidad_del_servicio",
);
const amendmentThreePayroll = amendmentThreeLiquidation.rows.find(
  (row) => row.tipo_amparo === "salarios_y_prestaciones_sociales",
);
const amendmentThreeRce = amendmentThreeLiquidation.rows.find(
  (row) => row.tipo_amparo === "responsabilidad_civil_extracontractual",
);

assert.equal(amendmentThreeLiquidation.valor_adicion, 406187168);
assert.equal(amendmentThreeLiquidation.dias_prorroga, 61);
assert.equal(amendmentThreeCompliance?.valor_asegurado_adicion, 121856150.4);
assert.equal(amendmentThreeCompliance?.fecha_hasta, "2025-07-02");
assert.equal(amendmentThreeCompliance?.dias_vigencia_adicion, 516);
assert.equal(amendmentThreeQuality?.fecha_hasta, "2025-07-02");
assert.equal(amendmentThreeQuality?.dias_vigencia_adicion, 516);
assert.equal(amendmentThreePayroll?.fecha_hasta, "2028-06-02");
assert.equal(amendmentThreePayroll?.dias_vigencia_adicion, 1582);
assert.equal(amendmentThreeRce?.valor_asegurado_adicion, 0);
assert.equal(amendmentThreeRce?.prima_valor_adicionado, 0);
assert.equal(amendmentThreeRce?.prima_prorroga, 417808.22);
const amendmentThreeTotalsByBlock = calculateAmendmentTotalsByBlock(
  amendmentThreeLiquidation.rows,
);
assert.equal(
  amendmentThreeTotalsByBlock.general.prima_total,
  amendmentThreeLiquidation.totales.prima_total,
);
assert.equal(
  amendmentThreeTotalsByBlock.responsabilidad_civil.prima_valor_adicionado,
  0,
);
assert.equal(
  amendmentThreeTotalsByBlock.responsabilidad_civil.prima_total,
  amendmentThreeRce?.prima_total,
);
assert.ok(amendmentThreeTotalsByBlock.garantias.prima_total > 0);

const onlyExtensionExtraction = applyDeterministicAmendmentFallbacksForTest(
  buildAmendmentExtraction(),
  "Otrosí de prórroga sin adición de valor. El plazo se prorroga desde el 02 de febrero de 2025 hasta el 02 de marzo de 2025.",
);
assert.equal(
  onlyExtensionExtraction.tipo_modificacion.valor,
  "Prórroga de plazo sin adición de valor",
);
assert.equal(onlyExtensionExtraction.valor_adicion.valor, 0);

const onlyAdditionExtraction = applyDeterministicAmendmentFallbacksForTest(
  buildAmendmentExtraction(),
  "Otrosí de adición. Se adiciona al contrato el valor de $203.093.584.",
);
assert.equal(onlyAdditionExtraction.tipo_modificacion.valor, "Adición de valor");
assert.equal(onlyAdditionExtraction.valor_adicion.valor, 203093584);

const additionAndExtensionExtraction = applyDeterministicAmendmentFallbacksForTest(
  buildAmendmentExtraction(),
  "Otrosí de adición y prórroga. Se adiciona al contrato el valor de $203.093.584. El plazo se prorroga desde el 02 de marzo de 2025 hasta el 02 de abril de 2025.",
);
assert.equal(
  additionAndExtensionExtraction.tipo_modificacion.valor,
  "Adición de valor + prórroga de plazo",
);

const objectOnlyExtraction = applyDeterministicAmendmentFallbacksForTest(
  buildAmendmentExtraction(),
  "Otrosí para modificar el objeto contractual sin impacto económico.",
);
assert.equal(
  objectOnlyExtraction.tipo_modificacion.valor,
  "Cambio de objeto sin impacto asegurable",
);

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
assert.equal(complianceCoverage.base_vigencia, "fecha_fin_contrato");
assert.equal(complianceCoverage.fecha_desde, "2024-02-02");
assert.equal(complianceCoverage.fecha_hasta, "2025-03-04");
assert.equal(complianceCoverage.dias_adicionales, 30);
assert.equal(complianceCoverage.dias_vigencia, 396);
assert.equal(complianceCoverage.prima_neta, 1640591.55);
assert.equal(complianceCoverage.impuesto, 311712.39);
assert.equal(complianceCoverage.prima_total, 1952303.94);

const manualPremiumCoverage = normalizeCoverage(
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
    usar_prima_neta_manual: true,
    prima_neta_manual: 500000,
  },
  {
    valorContrato: 2520269003,
    fechaInicio: "2024-02-02",
    fechaFin: "2025-02-02",
  },
);

assert.equal(manualPremiumCoverage.prima_neta_automatica, 1640591.55);
assert.equal(manualPremiumCoverage.prima_neta_manual, 500000);
assert.equal(manualPremiumCoverage.usar_prima_neta_manual, true);
assert.equal(manualPremiumCoverage.prima_neta, 500000);
assert.equal(manualPremiumCoverage.impuesto, 95000);
assert.equal(manualPremiumCoverage.prima_total, 595000);

const automaticPremiumCoverage = normalizeCoverage(
  {
    tipo_amparo: "Cumplimiento",
    porcentaje: 0.3,
    tipo_vigencia: "contractual",
    base_vigencia: "fecha_fin_contrato",
    dias_adicionales: 30,
    fuente_texto: "Cumplimiento equivalente al treinta por ciento del contrato.",
    fuente_pagina: 10,
    confianza: "alta",
    tasa: 0.002,
    iva_porcentaje: 0.19,
    usar_prima_neta_manual: false,
    prima_neta_manual: 500000,
  },
  {
    valorContrato: 2520269003,
    fechaInicio: "2024-02-02",
    fechaFin: "2025-02-02",
  },
);

assert.equal(
  automaticPremiumCoverage.prima_neta,
  automaticPremiumCoverage.prima_neta_automatica,
);

const contractualStartBaseCoverage = normalizeCoverage(
  {
    tipo_amparo: "Cumplimiento",
    porcentaje: 0.3,
    cuantia_fija: null,
    valor_asegurado: null,
    tipo_vigencia: "contractual",
    base_vigencia: "fecha_inicio_contrato",
    dias_adicionales: 30,
    fecha_desde: null,
    fecha_hasta: null,
    fuente_texto:
      "Cumplimiento con vigencia igual al plazo de ejecución del contrato y treinta (30) días más.",
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

assert.equal(contractualStartBaseCoverage.base_vigencia, "fecha_fin_contrato");
assert.equal(contractualStartBaseCoverage.fecha_desde, "2024-02-02");
assert.equal(contractualStartBaseCoverage.fecha_hasta, "2025-03-04");
assert.equal(contractualStartBaseCoverage.dias_adicionales, 30);
assert.equal(contractualStartBaseCoverage.dias_vigencia, 396);

const misclassifiedContractualCoverage = normalizeCoverage(
  {
    tipo_amparo: "Cumplimiento",
    porcentaje: 0.3,
    cuantia_fija: null,
    valor_asegurado: null,
    tipo_vigencia: "post_contractual",
    base_vigencia: "fecha_inicio_contrato",
    dias_adicionales: null,
    fecha_desde: null,
    fecha_hasta: null,
    fuente_texto:
      "Vigencia igual al término de vigencia del contrato y tres (3) meses más.",
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

assert.equal(misclassifiedContractualCoverage.tipo_vigencia, "contractual");
assert.equal(misclassifiedContractualCoverage.base_vigencia, "fecha_fin_contrato");
assert.equal(misclassifiedContractualCoverage.fecha_desde, "2024-02-02");
assert.equal(misclassifiedContractualCoverage.fecha_hasta, "2025-05-03");
assert.equal(misclassifiedContractualCoverage.dias_adicionales, 90);

const contractualQualityStartBaseCoverage = normalizeCoverage(
  {
    tipo_amparo: "Calidad del servicio",
    porcentaje: 0.3,
    cuantia_fija: null,
    valor_asegurado: null,
    tipo_vigencia: "contractual",
    base_vigencia: "fecha_inicio_contrato",
    dias_adicionales: null,
    fecha_desde: null,
    fecha_hasta: null,
    fuente_texto:
      "Garantía de calidad del servicio con vigencia igual al plazo de ejecución del mismo y treinta (30) días más, contados a partir del Acta de Recibo Final.",
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

assert.equal(contractualQualityStartBaseCoverage.fecha_desde, "2024-02-02");
assert.equal(contractualQualityStartBaseCoverage.fecha_hasta, "2025-03-04");
assert.equal(contractualQualityStartBaseCoverage.dias_adicionales, 30);
assert.equal(contractualQualityStartBaseCoverage.dias_vigencia, 396);
assert.equal(contractualQualityStartBaseCoverage.requiere_revision, true);
assert.match(
  contractualQualityStartBaseCoverage.motivo_revision ?? "",
  /acta de recibo final/i,
);

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

function sourcedValue(valor = null) {
  return {
    valor,
    confianza: "baja",
    pagina: null,
    fuente: null,
  };
}

function sourcedNumber(valor = null) {
  return {
    valor,
    confianza: "baja",
    pagina: null,
    fuente: null,
  };
}

function sourcedInteger(valor = null) {
  return {
    valor,
    confianza: "baja",
    pagina: null,
    fuente: null,
  };
}

function sourcedDate(valor = null) {
  return {
    valor,
    confianza: "baja",
    pagina: null,
    fuente: null,
  };
}

function sourcedBoolean(valor = null) {
  return {
    valor,
    confianza: "baja",
    pagina: null,
    fuente: null,
  };
}

function buildContractExtraction(overrides = {}) {
  return aiExtractionSchema.parse({
    numero_contrato: sourcedValue("004 DE 2024"),
    tipo_contrato: {
      valor: "estatal",
      confianza: "media",
      pagina: null,
      fuente: null,
    },
    contratante: {
      nombre: "Contratante",
      nit: null,
      confianza: "media",
      pagina: null,
      fuente: null,
    },
    contratista: {
      nombre: "Contratista",
      nit: null,
      confianza: "media",
      pagina: null,
      fuente: null,
    },
    objeto: sourcedValue("Servicio"),
    valor_contrato: {
      valor_numerico: 1000,
      moneda: "COP",
      confianza: "media",
      pagina: null,
      fuente: null,
    },
    valor_contrato_total: sourcedNumber(null),
    valor_unitario_periodico: sourcedNumber(null),
    periodicidad_valor: sourcedValue(null),
    numero_periodos: sourcedInteger(null),
    explicacion_calculo_valor: sourcedValue(null),
    requiere_revision_valor: sourcedBoolean(null),
    fecha_inicio: sourcedDate("2024-01-01"),
    fecha_fin: sourcedDate("2024-12-31"),
    plazo: sourcedValue("12 meses"),
    garantias: [],
    campos_no_encontrados: [],
    alertas: [],
    ...overrides,
  });
}

function buildAmendmentExtraction(overrides = {}) {
  return amendmentExtractionSchema.parse({
    numero_modificacion: sourcedValue(null),
    tipo_modificacion: sourcedValue(null),
    contrato_afectado: sourcedValue(null),
    fecha_firma: sourcedDate(null),
    valor_contrato_anterior: sourcedNumber(null),
    valor_adicion: sourcedNumber(null),
    valor_adicion_total: sourcedNumber(null),
    valor_adicion_unitario: sourcedNumber(null),
    periodicidad_valor_adicion: sourcedValue(null),
    numero_periodos_adicionados: sourcedInteger(null),
    periodos_adicionados: [],
    requiere_multiplicacion: sourcedBoolean(null),
    explicacion_calculo_valor_adicion: sourcedValue(null),
    valor_contrato_acumulado: sourcedNumber(null),
    fecha_desde: sourcedDate(null),
    fecha_hasta: sourcedDate(null),
    dias_prorroga: sourcedInteger(null),
    objeto_nuevo: sourcedValue(null),
    requiere_ajuste_garantias: sourcedBoolean(null),
    impuesto_timbre: sourcedValue(null),
    fuente_texto: null,
    fuente_pagina: null,
    confianza: "baja",
    requiere_revision: true,
    motivo_revision: null,
    garantias: [],
    campos_no_encontrados: [],
    alertas: [],
    ...overrides,
  });
}

function buildActiveCoverage({
  tipo_amparo,
  porcentaje,
  valor_asegurado,
  fecha_hasta,
  tasa = 0.0019,
}) {
  return {
    tipo_amparo,
    porcentaje,
    valor_asegurado,
    valor_base_calculo: null,
    tasa,
    iva_porcentaje: 0.19,
    fecha_desde: "2024-02-02",
    fecha_hasta,
    dias_vigencia: null,
    subamparos: [],
  };
}

console.info("Validaciones de normalización completadas.");
