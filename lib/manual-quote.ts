import { diffDaysDateOnly } from "@/lib/date-only";

type ManualQuoteContract = {
  contratante: string | null;
  valor_contrato: number | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  objeto: string | null;
};

// Datos mínimos para validar una Nueva cotización; el tomador ya existe como cliente.
export function getManualQuoteIssues(
  contract: ManualQuoteContract,
  coverageCount: number,
) {
  const issues: string[] = [];

  if (!contract.contratante?.trim()) {
    issues.push("Falta el asegurado / contratante.");
  }

  if (contract.valor_contrato === null || !(contract.valor_contrato > 0)) {
    issues.push("Falta el valor del contrato.");
  }

  if (!contract.objeto?.trim()) {
    issues.push("Falta el objeto.");
  }

  if (!contract.fecha_inicio || !contract.fecha_fin) {
    issues.push("Faltan la fecha inicial y la fecha final.");
  } else if ((diffDaysDateOnly(contract.fecha_inicio, contract.fecha_fin) ?? 0) <= 0) {
    issues.push("La fecha final debe ser posterior a la fecha inicial.");
  }

  if (coverageCount < 1) {
    issues.push("Agrega al menos un amparo.");
  }

  return issues;
}
