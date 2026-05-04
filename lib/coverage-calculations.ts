import { DEFAULT_IVA_PERCENTAGE, DEFAULT_RCE_RATE } from "@/lib/constants";
import { normalizeDate, normalizeNumber, normalizeText } from "@/lib/normalizers";
import type { AIConfidence, AIExtraction } from "@/lib/schemas";

export type CoverageInput = CoverageCalculationInput;

export type ContractCoverageContext = {
  valorContrato: number | null;
  fechaInicio: string | null;
  fechaFin: string | null;
};

export type CoverageCalculationInput = Partial<AIExtraction["garantias"][number]> & {
  tipo_amparo: string;
  tasa?: number | null;
  tasa_manual?: boolean | null;
  iva_porcentaje?: number | null;
  valor_asegurado?: number | null;
  subamparos?: CoverageSubamparo[] | null;
};

export type CoverageSubamparo = {
  nombre: string;
  porcentaje_sublimite: number | null;
  valor_sublimite: number | null;
  origen: "contrato" | "regla_plantilla_afisec";
  calculable: boolean;
  requiere_revision: boolean;
  fuente_texto: string | null;
  fuente_pagina: number | null;
};

export type NormalizedCoverage = {
  tipo_amparo: string;
  porcentaje: number | null;
  cuantia_fija: number | null;
  valor_base_calculo: number | null;
  modo_calculo: string | null;
  valor_asegurado: number | null;
  tasa: number | null;
  dias_vigencia: number | null;
  iva_porcentaje: number;
  prima_neta: number | null;
  impuesto: number | null;
  prima_total: number | null;
  tasa_manual: boolean;
  tipo_vigencia: string | null;
  base_vigencia: string | null;
  fecha_desde: string | null;
  fecha_hasta: string | null;
  dias_adicionales: number | null;
  fuente_pagina: number | null;
  fuente_texto: string | null;
  subamparos: CoverageSubamparo[];
  confianza: AIConfidence;
  requiere_revision: boolean;
  motivo_revision: string | null;
};

export function normalizeCoverage(
  coverage: CoverageInput,
  contract: ContractCoverageContext,
): NormalizedCoverage {
  const reasons = new Set<string>();
  const isRce = isCivilLiabilityCoverage(
    coverage.tipo_amparo,
    coverage.fuente_texto,
  );
  const preparedCoverage = isRce
    ? normalizeCivilLiabilityInput(coverage)
    : coverage;
  const valueCalculation = calculateInsuredValue(
    preparedCoverage,
    contract,
    reasons,
  );
  const startsAt = calculateStartDate(preparedCoverage, contract, reasons);
  const endsAt = calculateEndDate(preparedCoverage, contract, reasons);
  const validityDays = calculateValidityDays(startsAt, endsAt, reasons);
  const ivaPercentage =
    normalizeNumber(preparedCoverage.iva_porcentaje) ?? DEFAULT_IVA_PERCENTAGE;
  const tasa =
    normalizeNumber(preparedCoverage.tasa) ?? (isRce ? DEFAULT_RCE_RATE : null);
  const premium = calculatePremium({
    insuredValue: valueCalculation.valor_asegurado,
    rate: tasa,
    validityDays,
    ivaPercentage,
  });

  if (preparedCoverage.confianza === "baja") {
    reasons.add("Confianza baja en la extracción.");
  }

  if (
    normalizeNumber(preparedCoverage.porcentaje) === null &&
    normalizeNumber(preparedCoverage.cuantia_fija) === null
  ) {
    reasons.add("Falta porcentaje o cuantía fija para calcular el amparo.");
  }

  if (preparedCoverage.base_vigencia === "acta_recibo_final") {
    reasons.add("La vigencia depende del acta de recibo final.");
  }

  if (hasPerUnitCondition(preparedCoverage.fuente_texto)) {
    reasons.add(
      "La cuantía aplica por empleado, persona o evento y requiere revisión humana.",
    );
  }

  if (isAmbiguousSource(preparedCoverage.fuente_texto)) {
    reasons.add("La fuente textual es insuficiente o ambigua.");
  }

  if (
    valueCalculation.valor_asegurado !== null &&
    valueCalculation.valor_asegurado <= 0
  ) {
    reasons.add("El valor asegurado calculado es cero o negativo.");
  }

  if (tasa === null) {
    reasons.add("Falta tasa para calcular prima.");
  }

  const subamparos = isRce
    ? buildCivilLiabilitySubcoverages(
        preparedCoverage,
        valueCalculation.valor_asegurado,
      )
    : preparedCoverage.subamparos ?? [];

  return {
    tipo_amparo: isRce
      ? "responsabilidad_civil_extracontractual"
      : preparedCoverage.tipo_amparo,
    porcentaje: preparedCoverage.porcentaje ?? null,
    cuantia_fija: preparedCoverage.cuantia_fija ?? null,
    valor_base_calculo: valueCalculation.valor_base_calculo,
    modo_calculo: valueCalculation.modo_calculo,
    valor_asegurado: valueCalculation.valor_asegurado,
    tasa,
    dias_vigencia: validityDays,
    iva_porcentaje: ivaPercentage,
    prima_neta: premium.prima_neta,
    impuesto: premium.impuesto,
    prima_total: premium.prima_total,
    tasa_manual: Boolean(preparedCoverage.tasa_manual),
    tipo_vigencia: preparedCoverage.tipo_vigencia ?? null,
    base_vigencia: preparedCoverage.base_vigencia ?? null,
    fecha_desde: startsAt,
    fecha_hasta: endsAt,
    dias_adicionales: getEffectiveAdditionalDays(preparedCoverage),
    fuente_pagina: preparedCoverage.fuente_pagina ?? null,
    fuente_texto: preparedCoverage.fuente_texto ?? null,
    subamparos,
    confianza: preparedCoverage.confianza ?? "baja",
    requiere_revision: reasons.size > 0,
    motivo_revision: reasons.size > 0 ? Array.from(reasons).join(" ") : null,
  };
}

function calculateInsuredValue(
  coverage: CoverageInput,
  contract: ContractCoverageContext,
  reasons: Set<string>,
) {
  const fixedAmount = normalizeNumber(coverage.cuantia_fija);
  const percentage = normalizeNumber(coverage.porcentaje);

  if (fixedAmount !== null) {
    return {
      valor_base_calculo: null,
      modo_calculo: "cuantia_fija",
      valor_asegurado: roundMoney(fixedAmount),
    };
  }

  if (percentage !== null && contract.valorContrato !== null) {
    return {
      valor_base_calculo: contract.valorContrato,
      modo_calculo: "porcentaje_valor_contrato",
      valor_asegurado: roundMoney(contract.valorContrato * percentage),
    };
  }

  const explicitInsuredValue = normalizeNumber(coverage.valor_asegurado);

  if (explicitInsuredValue !== null) {
    reasons.add("Valor asegurado ingresado manualmente sin regla de cálculo.");

    return {
      valor_base_calculo: null,
      modo_calculo: "valor_asegurado_manual",
      valor_asegurado: roundMoney(explicitInsuredValue),
    };
  }

  reasons.add("No hay datos suficientes para calcular el valor asegurado.");
  return {
    valor_base_calculo: contract.valorContrato,
    modo_calculo: "pendiente_revision",
    valor_asegurado: null,
  };
}

function normalizeCivilLiabilityInput(
  coverage: CoverageInput,
): CoverageInput {
  const fixedAmount =
    normalizeNumber(coverage.cuantia_fija) ??
    normalizeNumber(coverage.valor_asegurado) ??
    extractCurrencyAmount(coverage.fuente_texto);

  return {
    ...coverage,
    tipo_amparo: "responsabilidad_civil_extracontractual",
    porcentaje: null,
    cuantia_fija: fixedAmount,
    valor_asegurado: fixedAmount,
    tasa: normalizeNumber(coverage.tasa) ?? DEFAULT_RCE_RATE,
    tipo_vigencia: coverage.tipo_vigencia ?? "contractual",
    base_vigencia: coverage.base_vigencia ?? "fecha_fin_contrato",
    dias_adicionales: normalizeNumber(coverage.dias_adicionales) ?? 30,
    fecha_desde: null,
    fecha_hasta: null,
  };
}

function buildCivilLiabilitySubcoverages(
  coverage: CoverageInput,
  insuredValue: number | null,
): CoverageSubamparo[] {
  const page = coverage.fuente_pagina ?? null;
  const source = coverage.fuente_texto ?? null;
  const templateSource =
    "El contrato exige el amparo, pero no define cuantía individual. El 50% proviene de la plantilla de liquidación.";

  const defaults: CoverageSubamparo[] = [
    {
      nombre: "PLO",
      porcentaje_sublimite: 1,
      valor_sublimite: insuredValue,
      origen: "contrato",
      calculable: true,
      requiere_revision: false,
      fuente_texto:
        source ??
        "Predios, Labores y Operaciones, PLO, con límite asegurado del 100% de lo exigido para esta póliza.",
      fuente_pagina: page,
    },
    ...[
      "Contratistas y subcontratistas",
      "RC Patronal",
      "RC Cruzada",
      "Vehículos propios y no propios",
    ].map((name) => ({
      nombre: name,
      porcentaje_sublimite: 0.5,
      valor_sublimite:
        insuredValue === null ? null : roundMoney(insuredValue * 0.5),
      origen: "regla_plantilla_afisec" as const,
      calculable: false,
      requiere_revision: true,
      fuente_texto: templateSource,
      fuente_pagina: page,
    })),
  ];

  if (!coverage.subamparos || coverage.subamparos.length === 0) {
    return defaults;
  }

  const byKey = new Map(
    defaults.map((subamparo) => [getCivilLiabilitySubcoverageKey(subamparo.nombre), subamparo]),
  );

  coverage.subamparos.forEach((subamparo) => {
    const key = getCivilLiabilitySubcoverageKey(subamparo.nombre);
    const current = byKey.get(key);
    const isPlo = key === "plo";

    byKey.set(key, {
      nombre: current?.nombre ?? subamparo.nombre,
      porcentaje_sublimite: isPlo
        ? 1
        : subamparo.porcentaje_sublimite ?? current?.porcentaje_sublimite ?? null,
      valor_sublimite:
        subamparo.valor_sublimite ?? current?.valor_sublimite ?? null,
      origen: isPlo ? "contrato" : subamparo.origen,
      calculable: isPlo,
      requiere_revision: isPlo ? subamparo.requiere_revision : true,
      fuente_texto: subamparo.fuente_texto ?? current?.fuente_texto ?? null,
      fuente_pagina: subamparo.fuente_pagina ?? current?.fuente_pagina ?? null,
    });
  });

  return Array.from(byKey.values());
}

function calculateStartDate(
  coverage: CoverageInput,
  contract: ContractCoverageContext,
  reasons: Set<string>,
) {
  const explicitStartDate = normalizeDate(coverage.fecha_desde);

  if (explicitStartDate !== null) {
    return explicitStartDate;
  }

  if (
    (coverage.tipo_vigencia === "contractual" ||
      coverage.tipo_vigencia === "post_contractual" ||
      isPayrollCoverage(coverage.tipo_amparo)) &&
    contract.fechaInicio
  ) {
    return contract.fechaInicio;
  }

  reasons.add("No hay fecha desde suficiente para la vigencia del amparo.");
  return null;
}

function calculateEndDate(
  coverage: CoverageInput,
  contract: ContractCoverageContext,
  reasons: Set<string>,
) {
  if (coverage.base_vigencia === "acta_recibo_final") {
    reasons.add(
      "La vigencia se cuenta desde acta de recibo final y no existe esa fecha.",
    );
    return null;
  }

  const explicitEndDate = normalizeDate(coverage.fecha_hasta);

  if (explicitEndDate !== null) {
    return explicitEndDate;
  }

  const additionalDays = getEffectiveAdditionalDays(coverage);

  if (
    (coverage.tipo_vigencia === "contractual" ||
      coverage.tipo_vigencia === "post_contractual" ||
      isPayrollCoverage(coverage.tipo_amparo)) &&
    contract.fechaFin
  ) {
    return addDays(contract.fechaFin, additionalDays ?? 0);
  }

  if (
    coverage.tipo_vigencia === "contractual" ||
    coverage.tipo_vigencia === "post_contractual" ||
    additionalDays !== null
  ) {
    reasons.add("Falta fecha fin del contrato para calcular fecha hasta.");
    return null;
  }

  reasons.add("No hay base suficiente para calcular fecha hasta.");
  return null;
}

function calculateValidityDays(
  startsAt: string | null,
  endsAt: string | null,
  reasons: Set<string>,
) {
  if (!startsAt || !endsAt) {
    reasons.add("Faltan fechas suficientes para calcular días de vigencia.");
    return null;
  }

  const start = new Date(`${startsAt}T00:00:00.000Z`);
  const end = new Date(`${endsAt}T00:00:00.000Z`);

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    reasons.add("Hay fechas inválidas para calcular días de vigencia.");
    return null;
  }

  const days = Math.round(
    (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (days <= 0) {
    reasons.add("Los días de vigencia calculados son cero o negativos.");
    return null;
  }

  return days;
}

function calculatePremium({
  insuredValue,
  rate,
  validityDays,
  ivaPercentage,
}: {
  insuredValue: number | null;
  rate: number | null;
  validityDays: number | null;
  ivaPercentage: number;
}) {
  if (insuredValue === null || rate === null || validityDays === null) {
    return {
      prima_neta: null,
      impuesto: null,
      prima_total: null,
    };
  }

  const netPremium = roundMoney((insuredValue * rate * validityDays) / 365);
  const tax = roundMoney(netPremium * ivaPercentage);

  return {
    prima_neta: netPremium,
    impuesto: tax,
    prima_total: roundMoney(netPremium + tax),
  };
}

function getEffectiveAdditionalDays(coverage: CoverageInput) {
  if (isPayrollCoverage(coverage.tipo_amparo)) {
    return 1095;
  }

  const additionalDays = normalizeNumber(coverage.dias_adicionales);

  if (additionalDays !== null) {
    return Math.trunc(additionalDays);
  }

  if (
    coverage.tipo_vigencia === "contractual" ||
    coverage.tipo_vigencia === "post_contractual"
  ) {
    return 0;
  }

  return null;
}

function addDays(date: string, days: number) {
  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  parsedDate.setUTCDate(parsedDate.getUTCDate() + days);
  return parsedDate.toISOString().slice(0, 10);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isPayrollCoverage(type: string | null | undefined) {
  const normalized = normalizeText(type) ?? "";

  return normalized.includes("salarios") || normalized.includes("prestaciones");
}

function hasPerUnitCondition(source: string | null | undefined) {
  const normalized = normalizeText(source) ?? "";

  return [
    "por empleado",
    "por persona",
    "por trabajador",
    "por evento",
    "cada empleado",
    "cada persona",
  ].some((marker) => normalized.includes(marker));
}

function isCivilLiabilityCoverage(
  type: string | null | undefined,
  source: string | null | undefined,
) {
  const text = (normalizeText(`${type ?? ""} ${source ?? ""}`) ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return (
    text.includes("responsabilidad civil") ||
    text.includes("extracontractual") ||
    text.includes("predios") ||
    text.includes("labores") ||
    text.includes("operaciones") ||
    text.includes("plo") ||
    text.includes("patronal") ||
    text.includes("civil cruzada") ||
    text.includes("vehiculos propios") ||
    text.includes("vehiculos no propios") ||
    text.includes("subcontrat")
  );
}

function extractCurrencyAmount(source: string | null | undefined) {
  if (!source) {
    return null;
  }

  const amounts = Array.from(source.matchAll(/\$\s*[\d.,]+/g))
    .map((match) => normalizeNumber(match[0]))
    .filter((amount): amount is number => amount !== null);

  return amounts.length > 0
    ? amounts.sort((left, right) => right - left)[0]
    : null;
}

function getCivilLiabilitySubcoverageKey(name: string) {
  const normalized = (normalizeText(name) ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (normalized.includes("plo") || normalized.includes("predios")) {
    return "plo";
  }

  if (normalized.includes("subcontrat")) {
    return "contratistas_subcontratistas";
  }

  if (normalized.includes("patronal")) {
    return "rc_patronal";
  }

  if (normalized.includes("cruzada")) {
    return "rc_cruzada";
  }

  if (normalized.includes("vehicul")) {
    return "vehiculos";
  }

  return normalized;
}

function isAmbiguousSource(source: string | null | undefined) {
  if (!source || source.trim().length < 12) {
    return true;
  }

  return [
    "por definir",
    "no se especifica",
    "sin especificar",
    "aproximad",
    "estimad",
    "según corresponda",
    "segun corresponda",
  ].some((marker) => source.toLowerCase().includes(marker));
}
