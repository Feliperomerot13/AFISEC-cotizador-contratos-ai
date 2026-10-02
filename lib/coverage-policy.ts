// Clasificación única de amparos por póliza. Todo detector de RCE debe pasar por este módulo.

export type CoveragePolicy = "cumplimiento" | "responsabilidad_civil";

export const COVERAGE_POLICY_ORDER: CoveragePolicy[] = [
  "cumplimiento",
  "responsabilidad_civil",
];

export const COVERAGE_POLICY_LABELS: Record<CoveragePolicy, string> = {
  cumplimiento: "Póliza de cumplimiento",
  responsabilidad_civil: "Póliza de responsabilidad civil",
};

export const CIVIL_LIABILITY_COVERAGE_TYPE =
  "responsabilidad_civil_extracontractual";

// Nombre de amparo en minúsculas, sin acentos y con separadores reducidos a espacios.
export function normalizeCoverageLabel(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const CIVIL_LIABILITY_NAME_PATTERNS = [
  /\bresponsabilidad civil\b/,
  /\bextracontractual\b/,
  /\brce\b/,
  /\bplo\b/,
  /\bpredios\b/,
  /\blabores y operaciones\b/,
  /\bpatronal\b/,
  /\bcivil cruzada\b/,
  /\brc cruzada\b/,
  /\bvehiculos (no )?propios\b/,
  /\bsubcontrat\w*/,
];

// Amparos que nunca se reclasifican por el texto de la cláusula, que suele citar varias garantías.
const OTHER_COVERAGE_NAME_PATTERNS = [
  /\bcumplimiento\b/,
  /\banticipo\b/,
  /\bsalarios?\b/,
  /\bprestaciones\b/,
  /\bcalidad\b/,
  /\bestabilidad\b/,
  /\baccidentes?\b/,
  /\bequipos\b/,
  /\bmaquinaria\b/,
  /\bgastos medicos\b/,
];

export function isCivilLiabilityName(tipoAmparo: string | null | undefined) {
  const label = normalizeCoverageLabel(tipoAmparo);

  return CIVIL_LIABILITY_NAME_PATTERNS.some((pattern) => pattern.test(label));
}

// El texto fuente solo decide cuando el nombre no identifica el amparo.
export function isCivilLiabilityCoverage(
  tipoAmparo: string | null | undefined,
  fuenteTexto?: string | null,
) {
  if (isCivilLiabilityName(tipoAmparo)) {
    return true;
  }

  const label = normalizeCoverageLabel(tipoAmparo);

  if (OTHER_COVERAGE_NAME_PATTERNS.some((pattern) => pattern.test(label))) {
    return false;
  }

  const source = normalizeCoverageLabel(fuenteTexto);

  return (
    source.includes("responsabilidad civil extracontractual") ||
    source.includes("predios labores y operaciones")
  );
}

export function classifyCoveragePolicy(
  tipoAmparo: string | null | undefined,
  fuenteTexto?: string | null,
): CoveragePolicy {
  return isCivilLiabilityCoverage(tipoAmparo, fuenteTexto)
    ? "responsabilidad_civil"
    : "cumplimiento";
}
