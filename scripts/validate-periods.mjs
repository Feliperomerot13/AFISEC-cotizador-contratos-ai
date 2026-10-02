import assert from "node:assert/strict";
import { normalizeCoverage } from "../lib/coverage-calculations.ts";
import {
  addMonthsToDateOnly,
  addPeriodToDateOnly,
} from "../lib/date-only.ts";
import { buildRenewalSnapshot } from "../lib/renewal.ts";
import { buildQuoteSnapshot } from "../lib/quotes.ts";
import {
  findAdditionalPeriod,
  normalizePeriodUnit,
  parseSpanishNumberWords,
} from "../lib/spanish-dates.ts";

// --- Aritmética de calendario ---
assert.equal(addMonthsToDateOnly("2026-01-31", 1), "2026-02-28");
assert.equal(addMonthsToDateOnly("2028-01-31", 1), "2028-02-29");
assert.equal(addMonthsToDateOnly("2026-12-31", 2), "2027-02-28");
assert.equal(addMonthsToDateOnly("2026-08-31", 6), "2027-02-28");
assert.equal(addMonthsToDateOnly("2026-03-31", -1), "2026-02-28");
assert.equal(addMonthsToDateOnly("2026-11-15", 3), "2027-02-15");
assert.equal(addPeriodToDateOnly("2024-02-29", 1, "anios"), "2025-02-28");
assert.equal(addPeriodToDateOnly("2024-02-29", 4, "anios"), "2028-02-29");
assert.equal(addPeriodToDateOnly("2026-12-31", 1, "anios"), "2027-12-31");
assert.equal(addPeriodToDateOnly("2026-12-31", 45, "dias"), "2027-02-14");
assert.equal(addMonthsToDateOnly("fecha", 1), null);

// --- Lectura de periodos en texto ---
assert.equal(normalizePeriodUnit("Meses"), "meses");
assert.equal(normalizePeriodUnit("años"), "anios");
assert.equal(normalizePeriodUnit("Días"), "dias");
assert.equal(normalizePeriodUnit("semanas"), null);
assert.equal(parseSpanishNumberWords("treinta y cinco"), 35);
assert.equal(parseSpanishNumberWords("ciento veinte"), 120);
assert.equal(parseSpanishNumberWords("doscientos cuarenta"), 240);
assert.equal(parseSpanishNumberWords("un"), 1);

function period(text) {
  const found = findAdditionalPeriod(text);

  return found ? [found.cantidad, found.unidad, found.habiles] : null;
}

assert.deepEqual(period("Vigencia igual al plazo del contrato y dos meses más."), [2, "meses", false]);
assert.deepEqual(period("Vigencia igual al plazo y 2 meses más. Pago a 30 días."), [2, "meses", false]);
assert.deepEqual(period("El pago se hará a 30 días. Vigencia igual al plazo y 2 meses más."), [2, "meses", false]);
assert.deepEqual(period("Vigencia igual al término y tres (3) meses más."), [3, "meses", false]);
assert.deepEqual(period("Vigencia de un (1) año contado a partir del Acta de Recibo Final."), [1, "anios", false]);
assert.deepEqual(period("Vigencia del plazo y 45 días adicionales."), [45, "dias", false]);
assert.deepEqual(period("Vigencia del plazo y treinta y cinco días más."), [35, "dias", false]);
assert.deepEqual(period("Cuarenta (40) días hábiles adicionales al plazo."), [40, "dias", true]);
assert.deepEqual(period("Vigencia por doscientos cuarenta (240) días."), [240, "dias", false]);
assert.deepEqual(period("Plazo de ejecución: doce meses y seis meses más."), [6, "meses", false]);
assert.equal(period("Vigencia igual al plazo del contrato."), null);
assert.equal(period(null), null);

// --- normalizeCoverage con cantidad + unidad ---
const context = {
  valorContrato: 1000000000,
  baseCalculoAmparos: 1000000000,
  fechaInicio: "2026-01-01",
  fechaFin: "2026-12-31",
};

function cumplimiento(overrides = {}) {
  return normalizeCoverage(
    {
      tipo_amparo: "Cumplimiento",
      porcentaje: 0.1,
      tipo_vigencia: "contractual",
      base_vigencia: "fecha_fin_contrato",
      fuente_texto: "Cumplimiento por el 10% del valor del contrato con vigencia del plazo.",
      fuente_pagina: 3,
      confianza: "alta",
      tasa: 0.002,
      ...overrides,
    },
    context,
  );
}

const days45 = cumplimiento({ periodo_adicional_cantidad: 45, periodo_adicional_unidad: "dias" });
assert.equal(days45.fecha_hasta, "2027-02-14");
assert.equal(days45.dias_adicionales, 45);

const months2 = cumplimiento({ periodo_adicional_cantidad: 2, periodo_adicional_unidad: "meses" });
assert.equal(months2.fecha_hasta, "2027-02-28");
assert.equal(months2.dias_adicionales, 59);
assert.equal(months2.dias_vigencia, 423);
assert.equal(months2.periodo_adicional_cantidad, 2);
assert.equal(months2.periodo_adicional_unidad, "meses");

const year1 = cumplimiento({ periodo_adicional_cantidad: 1, periodo_adicional_unidad: "anios" });
assert.equal(year1.fecha_hasta, "2027-12-31");
assert.equal(year1.dias_adicionales, 365);

// Registros previos (solo dias_adicionales, sin unidad) se comportan igual que antes.
const legacy = cumplimiento({ dias_adicionales: 45 });
assert.equal(legacy.fecha_hasta, "2027-02-14");
assert.equal(legacy.periodo_adicional_unidad, "dias");
assert.equal(legacy.periodo_adicional_cantidad, 45);

// Fecha hasta manual prevalece sobre el periodo.
const manualEnd = cumplimiento({
  periodo_adicional_cantidad: 2,
  periodo_adicional_unidad: "meses",
  fecha_hasta: "2027-06-15",
  fecha_hasta_manual: true,
});
assert.equal(manualEnd.fecha_hasta, "2027-06-15");

// Texto con periodo en palabras y valor 0 recibido: se toma del texto y queda para revisión.
const wordsAndZero = cumplimiento({
  dias_adicionales: 0,
  fuente_texto: "Vigencia igual al plazo del contrato y dos meses más.",
});
assert.equal(wordsAndZero.fecha_hasta, "2027-02-28");
assert.equal(wordsAndZero.periodo_adicional_unidad, "meses");
assert.match(wordsAndZero.motivo_revision ?? "", /se tomó del texto/);

// El plazo de pago no se confunde con el periodo adicional.
const withPayment = cumplimiento({
  dias_adicionales: null,
  fuente_texto: "Vigencia igual al plazo y 2 meses más. Pago a 30 días.",
});
assert.equal(withPayment.fecha_hasta, "2027-02-28");

// Días hábiles: se calcula como calendario y se marca para revisión manual.
const businessDays = cumplimiento({
  dias_adicionales: null,
  fuente_texto: "Vigencia igual al plazo y cuarenta (40) días hábiles adicionales.",
});
assert.equal(businessDays.requiere_revision, true);
assert.match(businessDays.motivo_revision ?? "", /días hábiles/);

// Reglas por defecto sin cambios: 30 días contractuales, 1095 salarios.
const defaultCompliance = cumplimiento({ tipo_vigencia: null, base_vigencia: null });
assert.equal(defaultCompliance.dias_adicionales, 30);
assert.equal(defaultCompliance.periodo_adicional_unidad, "dias");

// --- Snapshot y renovación conservan la unidad ---
function amparoRow(overrides) {
  return {
    id: 1,
    contrato_id: 1,
    modificacion_id: null,
    tipo_amparo: "cumplimiento",
    valor_asegurado: 100000000,
    valor_base_calculo: 100000000,
    modo_calculo: "porcentaje_valor_contrato",
    fecha_desde: "2026-01-01",
    fecha_hasta: "2027-02-28",
    dias_vigencia: 423,
    prima_neta: 1000000,
    impuesto: 190000,
    prima_total: 1190000,
    tasa: 0.002,
    tasa_manual: false,
    subamparos: [],
    periodo_adicional_cantidad: 2,
    periodo_adicional_unidad: "meses",
    fecha_hasta_manual: false,
    ...overrides,
  };
}

const contract = {
  id: 1, numero_contrato: "C-1", objeto: "Objeto", tipo_contrato: "estatal", valor_contrato: 1e9,
  base_calculo_amparos: 1e9, base_calculo_incluye_iva: false, moneda: "COP", fecha_inicio: "2026-01-01",
  fecha_fin: "2026-12-31", plazo: null, contratante: "Entidad", contratante_nit: null,
  contratista: "Contratista", contratista_nit: null,
};
const client = { id: 1, nombre: "Tomador", nit: "900", ejecutivo: "Carolina Barragán" };
const snapshot = buildQuoteSnapshot({
  contract,
  client,
  amparos: [amparoRow({}), amparoRow({ tipo_amparo: "calidad", periodo_adicional_unidad: "dias", periodo_adicional_cantidad: null }), amparoRow({ tipo_amparo: "salarios", fecha_hasta_manual: true })],
  generatedAt: "2026-10-01T10:00:00.000Z",
});

assert.deepEqual(snapshot.amparos[0].periodo_adicional, { cantidad: 2, unidad: "meses" });
assert.equal(snapshot.amparos[1].periodo_adicional, undefined);
assert.equal(snapshot.amparos[2].periodo_adicional, undefined, "una fecha manual no se reaplica como periodo");

const renewal = buildRenewalSnapshot({
  baseSnapshot: snapshot,
  generatedAt: "2027-01-10T10:00:00.000Z",
  fechaInicio: "2027-01-01",
  fechaFin: "2027-06-30",
});

// Con unidad: 2 meses sobre 2027-06-30 (calendario). Sin ella: 59 días de diferencia (comportamiento anterior).
assert.equal(renewal.amparos[0].fecha_hasta, "2027-08-30");
assert.equal(renewal.amparos[1].fecha_hasta, "2027-08-28");
assert.equal(renewal.amparos[2].fecha_hasta, "2027-08-28");
assert.equal(renewal.schema_version, 2);

console.log("Validaciones de periodos completadas.");
