import assert from "node:assert/strict";
import { addPeriodToDateOnly } from "../lib/date-only.ts";
import {
  contractTermUnitLabel,
  parseContractTerm,
  upsertContractTermText,
} from "../lib/contract-term.ts";

// --- Fecha fin del contrato: días, meses y años de calendario ---
assert.equal(addPeriodToDateOnly("2026-09-13", 360, "dias"), "2027-09-08");
assert.equal(addPeriodToDateOnly("2026-09-13", 12, "meses"), "2027-09-13");
assert.equal(addPeriodToDateOnly("2026-09-13", 1, "anios"), "2027-09-13");
assert.equal(addPeriodToDateOnly("2026-01-31", 1, "meses"), "2026-02-28");
assert.equal(addPeriodToDateOnly("2028-01-31", 1, "meses"), "2028-02-29");
assert.equal(addPeriodToDateOnly("2024-02-29", 1, "anios"), "2025-02-28");
// 12 meses no equivale a 360 días ni 1 año a 365.
assert.notEqual(
  addPeriodToDateOnly("2026-09-13", 12, "meses"),
  addPeriodToDateOnly("2026-09-13", 360, "dias"),
);

// --- Lectura del plazo desde texto ---
function term(text) {
  const found = parseContractTerm(text);

  return found ? [found.cantidad, found.unidad] : null;
}

assert.deepEqual(term("doscientos cuarenta (240) días calendario"), [240, "dias"]);
assert.deepEqual(term("El plazo de ejecución será de 360 días"), [360, "dias"]);
assert.deepEqual(term("doce (12) meses contados a partir del acta de inicio"), [12, "meses"]);
assert.deepEqual(term("Un (1) año"), [1, "anios"]);
assert.deepEqual(term("Plazo de 2 años"), [2, "anios"]);
assert.deepEqual(term("Plazo de ejecución: 6 meses. Pago a 30 días."), [6, "meses"]);
assert.deepEqual(term("Pago a 30 días. Plazo de ejecución: 6 meses"), [6, "meses"]);
assert.deepEqual(term("Plazo de ejecución: 6 meses. Pago a 30 días"), [6, "meses"]);
assert.deepEqual(
  term("Duración del contrato: doce (12) meses. Pago de facturas a 45 días"),
  [12, "meses"],
);
assert.equal(term("Pago a 30 días"), null);
assert.deepEqual(term("6 meses"), [6, "meses"]);
assert.deepEqual(term("360 días"), [360, "dias"]);
assert.deepEqual(term("1 año"), [1, "anios"]);
assert.deepEqual(term("plazo calculable: 1 año"), [1, "anios"]);
assert.equal(term("Hasta el acta de inicio"), null);
assert.equal(term(""), null);
assert.equal(term(null), null);

// --- Texto persistido: se reconstruye cantidad + unidad tras recargar ---
assert.equal(upsertContractTermText("", 12, "meses"), "12 meses");
assert.equal(upsertContractTermText("", 1, "anios"), "1 año");
assert.equal(upsertContractTermText("", 1, "dias"), "1 día");
assert.equal(upsertContractTermText("", null, "dias"), "");
assert.equal(upsertContractTermText("360 días", 360, "dias"), "360 días");
// Escribir la cantidad dígito a dígito no acumula marcadores.
assert.equal(upsertContractTermText("1 día", 12, "dias"), "12 días");
assert.equal(upsertContractTermText("12 meses", 24, "meses"), "24 meses");

const edited = upsertContractTermText("doscientos cuarenta (240) días", 12, "meses");
assert.equal(edited, "doscientos cuarenta (240) días; plazo calculable: 12 meses");
assert.deepEqual(term(edited), [12, "meses"]);

const reedited = upsertContractTermText(edited, 2, "anios");
assert.equal(reedited, "doscientos cuarenta (240) días; plazo calculable: 2 años");
assert.deepEqual(term(reedited), [2, "anios"]);

// Volver al valor original no deja marcador duplicado.
assert.equal(upsertContractTermText(reedited, 240, "dias"), "doscientos cuarenta (240) días; plazo calculable: 240 días");
assert.deepEqual(term(upsertContractTermText(reedited, 240, "dias")), [240, "dias"]);

// Registros históricos con el marcador anterior en días siguen funcionando.
assert.deepEqual(term("Según contrato; plazo calculable: 180 días"), [180, "dias"]);
assert.equal(contractTermUnitLabel("meses", 1), "mes");
assert.equal(contractTermUnitLabel("anios", 3), "años");

console.log("Validaciones de plazo del contrato completadas.");
