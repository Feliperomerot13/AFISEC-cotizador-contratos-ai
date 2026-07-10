import {
  DEFAULT_COVERAGE_RATE,
  DEFAULT_IVA_PERCENTAGE,
  DEFAULT_RCE_RATE,
} from "@/lib/constants";
import {
  addDaysToDateOnly,
  diffDaysDateOnly,
} from "@/lib/date-only";
import { normalizeDate, normalizeNumber, normalizeText } from "@/lib/normalizers";
import type { AIConfidence, AIExtraction } from "@/lib/schemas";

type CoverageValidityBase =
  | "fecha_inicio_contrato"
  | "fecha_fin_contrato"
  | "acta_recibo_final"
  | "fecha_explicita"
  | "no_determinada"
  | "firma_contrato"
  | "otra";

export type CoverageInput = CoverageCalculationInput;

export type ContractCoverageContext = {
  valorContrato: number | null;
  baseCalculoAmparos?: number | null;
  valorAnticipo?: number | null;
  porcentajeAnticipo?: number | null;
  anticipoBaseIncluyeIva?: boolean | null;
  fechaInicio: string | null;
  fechaFin: string | null;
};

export type CoverageCalculationInput = Partial<AIExtraction["garantias"][number]> & {
  tipo_amparo: string;
  tasa?: number | null;
  tasa_manual?: boolean | null;
  usar_prima_neta_manual?: boolean | null;
  prima_neta_manual?: number | null;
  iva_porcentaje?: number | null;
  valor_base_calculo?: number | null;
  modo_calculo?: string | null;
  valor_asegurado?: number | null;
  valor_anticipo?: number | null;
  porcentaje_anticipo?: number | null;
  anticipo_base_incluye_iva?: boolean | null;
  fecha_desde_manual?: boolean | null;
  fecha_hasta_manual?: boolean | null;
  subamparos?: CoverageSubamparo[] | null;
};

export type CoverageSubamparo = {
  nombre: string;
  incluido: boolean;
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
  prima_neta_automatica: number | null;
  prima_neta_manual: number | null;
  usar_prima_neta_manual: boolean;
  impuesto: number | null;
  prima_total: number | null;
  tasa_manual: boolean;
  tipo_vigencia: string | null;
  base_vigencia: CoverageValidityBase;
  fecha_desde: string | null;
  fecha_desde_manual: boolean;
  fecha_hasta: string | null;
  fecha_hasta_manual: boolean;
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
  const explicitStartDate = normalizeDate(coverage.fecha_desde);
  const explicitEndDate = normalizeDate(coverage.fecha_hasta);
  const manualStartDateEnabled = Boolean(coverage.fecha_desde_manual);
  const manualEndDateEnabled = Boolean(coverage.fecha_hasta_manual);
  const validityAdjustedCoverage = normalizeContractualTermCoverageInput(coverage);
  const isRce = isCivilLiabilityCoverage(
    validityAdjustedCoverage.tipo_amparo,
    validityAdjustedCoverage.fuente_texto,
  );
  const preparedCoverage = isRce
    ? normalizeCivilLiabilityInput(validityAdjustedCoverage)
    : isAdvancePaymentCoverage(validityAdjustedCoverage)
      ? normalizeAdvancePaymentCoverageInput(validityAdjustedCoverage, contract)
    : validityAdjustedCoverage;
  const valueCalculation = calculateInsuredValue(
    preparedCoverage,
    contract,
    reasons,
  );
  const startsAt = calculateStartDate(
    preparedCoverage,
    contract,
    reasons,
    explicitStartDate,
    manualStartDateEnabled,
  );
  const endsAt = calculateEndDate(
    preparedCoverage,
    contract,
    reasons,
    explicitStartDate,
    explicitEndDate,
    manualStartDateEnabled,
    manualEndDateEnabled,
  );
  const validityDays = calculateValidityDays(startsAt, endsAt, reasons);
  const baseVigencia = resolveCoverageValidityBase(
    preparedCoverage,
    contract,
    explicitStartDate,
    explicitEndDate,
    reasons,
  );
  const ivaPercentage =
    normalizeNumber(preparedCoverage.iva_porcentaje) ?? DEFAULT_IVA_PERCENTAGE;
  const parsedRate = normalizeNumber(preparedCoverage.tasa);
  const tasa =
    parsedRate ??
    (preparedCoverage.tasa_manual
      ? null
      : isRce
        ? DEFAULT_RCE_RATE
        : valueCalculation.valor_asegurado !== null
          ? DEFAULT_COVERAGE_RATE
          : null);
  const automaticPremium = calculatePremium({
    insuredValue: valueCalculation.valor_asegurado,
    rate: tasa,
    validityDays,
    ivaPercentage,
  });
  const useManualNetPremium = Boolean(
    preparedCoverage.usar_prima_neta_manual,
  );
  const manualNetPremium = normalizeNumber(
    preparedCoverage.prima_neta_manual,
  );
  const premium =
    useManualNetPremium
      ? manualNetPremium !== null
        ? calculatePremiumFromNet({
            netPremium: manualNetPremium,
            ivaPercentage,
          })
        : {
            prima_neta: null,
            impuesto: null,
            prima_total: null,
          }
      : automaticPremium;

  if (preparedCoverage.confianza === "baja") {
    reasons.add("Confianza baja en la extracción.");
  }

  if (
    normalizeNumber(preparedCoverage.porcentaje) === null &&
    normalizeNumber(preparedCoverage.cuantia_fija) === null &&
    normalizeNumber(preparedCoverage.valor_asegurado) === null &&
    !isAdvancePaymentCoverage(preparedCoverage)
  ) {
    reasons.add("Falta porcentaje o cuantía fija para calcular el amparo.");
  }

  if (isClosureBasedPostContractualCoverage(preparedCoverage)) {
    reasons.add("La vigencia depende del acta de recibo final.");
  }

  if (
    isPayrollCoverage(preparedCoverage.tipo_amparo, preparedCoverage.fuente_texto) &&
    coverageTextIncludes(preparedCoverage, ["acta de recibo final", "acta de cierre"])
  ) {
    reasons.add(
      "La cláusula menciona ajuste con Acta de Recibo Final; se conserva fecha inicio del contrato para cotización y requiere revisión humana.",
    );
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

  if (useManualNetPremium && manualNetPremium === null) {
    reasons.add("Falta prima neta manual para aplicar el override.");
  }

  if (tasa === null && !useManualNetPremium) {
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
    porcentaje: valueCalculation.porcentaje ?? null,
    cuantia_fija: valueCalculation.cuantia_fija ?? null,
    valor_base_calculo: valueCalculation.valor_base_calculo,
    modo_calculo: valueCalculation.modo_calculo,
    valor_asegurado: valueCalculation.valor_asegurado,
    tasa,
    dias_vigencia: validityDays,
    iva_porcentaje: ivaPercentage,
    prima_neta: premium.prima_neta,
    prima_neta_automatica: automaticPremium.prima_neta,
    prima_neta_manual: manualNetPremium,
    usar_prima_neta_manual: useManualNetPremium,
    impuesto: premium.impuesto,
    prima_total: premium.prima_total,
    tasa_manual: Boolean(preparedCoverage.tasa_manual),
    tipo_vigencia: preparedCoverage.tipo_vigencia ?? null,
    base_vigencia: baseVigencia,
    fecha_desde: startsAt,
    fecha_desde_manual: manualStartDateEnabled,
    fecha_hasta: endsAt,
    fecha_hasta_manual: manualEndDateEnabled,
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
  const requestedMode = normalizeText(coverage.modo_calculo);
  const calculationBase =
    normalizeNumber(contract.baseCalculoAmparos) ??
    normalizeNumber(contract.valorContrato);

  if (isAdvancePaymentCoverage(coverage)) {
    const advanceValue =
      normalizeNumber(coverage.valor_anticipo) ??
      normalizeNumber(coverage.valor_asegurado) ??
      normalizeNumber(coverage.valor_base_calculo) ??
      normalizeNumber(contract.valorAnticipo);
    const advancePercentage = resolveAdvancePercentage(coverage, contract);
    const inferredAdvanceBaseIncludesIva = inferAdvanceBaseIncludesIva(
      coverage.fuente_texto,
    );
    let advanceBaseIncludesIva: boolean | null = null;

    if (typeof coverage.anticipo_base_incluye_iva === "boolean") {
      advanceBaseIncludesIva = coverage.anticipo_base_incluye_iva;
    } else if (inferredAdvanceBaseIncludesIva !== null) {
      advanceBaseIncludesIva = inferredAdvanceBaseIncludesIva;
    } else if (typeof contract.anticipoBaseIncluyeIva === "boolean") {
      advanceBaseIncludesIva = contract.anticipoBaseIncluyeIva;
    }
    const advanceCalculationBase = resolveAdvanceCalculationBase(
      coverage,
      contract,
      advanceBaseIncludesIva,
    );

    if (advancePercentage !== null && advanceCalculationBase !== null) {
      if (advanceBaseIncludesIva === null) {
        reasons.add("Falta confirmar si la base del anticipo incluye IVA.");
      }

      const calculatedAdvance = roundMoney(
        advanceCalculationBase * advancePercentage,
      );

      return {
        porcentaje: advancePercentage,
        cuantia_fija: null,
        valor_base_calculo: advanceCalculationBase,
        modo_calculo: "anticipo_100",
        valor_asegurado: calculatedAdvance,
      };
    }

    if (advanceValue !== null) {
      if (advancePercentage !== null && advanceBaseIncludesIva === null) {
        reasons.add("Falta confirmar si la base del anticipo incluye IVA.");
      }

      return {
        porcentaje: advancePercentage,
        cuantia_fija: null,
        valor_base_calculo: roundMoney(advanceValue),
        modo_calculo: "anticipo_100",
        valor_asegurado: roundMoney(advanceValue),
      };
    }

    reasons.add(
      "Se detectó amparo de buen manejo de anticipo, pero no se encontró valor o porcentaje del anticipo.",
    );
    return {
      porcentaje: advancePercentage,
      cuantia_fija: null,
      valor_base_calculo: null,
      modo_calculo: "anticipo_100",
      valor_asegurado: null,
    };
  }

  if (requestedMode === "cuantia_fija" && fixedAmount !== null) {
    return {
      porcentaje: null,
      cuantia_fija: roundMoney(fixedAmount),
      valor_base_calculo: null,
      modo_calculo: "cuantia_fija",
      valor_asegurado: roundMoney(fixedAmount),
    };
  }

  if (
    requestedMode !== "cuantia_fija" &&
    percentage !== null &&
    calculationBase !== null
  ) {
    return {
      porcentaje: percentage,
      cuantia_fija: null,
      valor_base_calculo: calculationBase,
      modo_calculo: "porcentaje_valor_contrato",
      valor_asegurado: roundMoney(calculationBase * percentage),
    };
  }

  if (fixedAmount !== null) {
    return {
      porcentaje: null,
      cuantia_fija: roundMoney(fixedAmount),
      valor_base_calculo: null,
      modo_calculo: "cuantia_fija",
      valor_asegurado: roundMoney(fixedAmount),
    };
  }

  const explicitInsuredValue = normalizeNumber(coverage.valor_asegurado);

  if (explicitInsuredValue !== null) {
    reasons.add("Valor asegurado ingresado manualmente sin regla de cálculo.");

    return {
      porcentaje: null,
      cuantia_fija: null,
      valor_base_calculo: null,
      modo_calculo: "valor_asegurado_manual",
      valor_asegurado: roundMoney(explicitInsuredValue),
    };
  }

  reasons.add("No hay datos suficientes para calcular el valor asegurado.");
  return {
    porcentaje: percentage,
    cuantia_fija: null,
    valor_base_calculo: calculationBase,
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
    base_vigencia: "fecha_fin_contrato",
    dias_adicionales: normalizeNumber(coverage.dias_adicionales) ?? 30,
    fecha_desde: null,
    fecha_hasta: null,
  };
}

function normalizeContractualTermCoverageInput(
  coverage: CoverageInput,
): CoverageInput {
  if (!isContractualTermPlusAdditionalCoverage(coverage)) {
    return coverage;
  }

  const additionalDays =
    normalizeNumber(coverage.dias_adicionales) ??
    extractPostContractualDays(coverage.fuente_texto);
  const baseVigencia = coverageTextIncludes(coverage, ["acta de recibo final"])
    ? "acta_recibo_final"
    : "fecha_fin_contrato";

  return {
    ...coverage,
    tipo_vigencia: "contractual",
    base_vigencia: baseVigencia,
    dias_adicionales: additionalDays,
  };
}

function normalizeAdvancePaymentCoverageInput(
  coverage: CoverageInput,
  contract: ContractCoverageContext,
): CoverageInput {
  const advancePercentage = resolveAdvancePercentage(coverage, contract);
  const advanceValue =
    normalizeNumber(coverage.valor_anticipo) ??
    normalizeNumber(coverage.valor_asegurado) ??
    normalizeNumber(coverage.valor_base_calculo) ??
    normalizeNumber(contract.valorAnticipo);

  return {
    ...coverage,
    tipo_amparo: "buen_manejo_anticipo",
    porcentaje: advancePercentage,
    cuantia_fija: null,
    valor_asegurado: advanceValue,
    valor_anticipo: advanceValue,
    tipo_vigencia: coverage.tipo_vigencia ?? "contractual",
    base_vigencia: coverage.base_vigencia ?? "fecha_fin_contrato",
    dias_adicionales: normalizeNumber(coverage.dias_adicionales) ?? 30,
    fecha_desde: null,
    fecha_hasta: null,
  };
}

function resolveAdvancePercentage(
  coverage: CoverageInput,
  contract: ContractCoverageContext,
) {
  const explicitAdvancePercentage = normalizeNumber(coverage.porcentaje_anticipo);
  const storedPercentage = normalizeNumber(coverage.porcentaje);
  const sourcePercentage = extractAdvancePercentage(coverage.fuente_texto);
  const contractPercentage = normalizeNumber(contract.porcentajeAnticipo);

  if (explicitAdvancePercentage !== null) {
    return explicitAdvancePercentage;
  }

  if (storedPercentage !== null && storedPercentage > 0 && storedPercentage < 1) {
    return storedPercentage;
  }

  return sourcePercentage ?? contractPercentage;
}

function resolveAdvanceCalculationBase(
  coverage: CoverageInput,
  contract: ContractCoverageContext,
  advanceBaseIncludesIva: boolean | null,
) {
  const confirmedCoverageBase = normalizeNumber(coverage.valor_base_calculo);
  const confirmedContractBase = normalizeNumber(contract.baseCalculoAmparos);
  const contractValue = normalizeNumber(contract.valorContrato);
  const textBase = extractAdvanceBaseAmount(coverage.fuente_texto);

  if (confirmedCoverageBase !== null) {
    return confirmedCoverageBase;
  }

  if (advanceBaseIncludesIva === false) {
    if (textBase !== null) {
      return textBase;
    }

    if (
      confirmedCoverageBase !== null &&
      contractValue !== null &&
      confirmedCoverageBase < contractValue
    ) {
      return confirmedCoverageBase;
    }

    if (
      confirmedContractBase !== null &&
      contractValue !== null &&
      confirmedContractBase < contractValue
    ) {
      return confirmedContractBase;
    }

    return contractValue === null
      ? confirmedContractBase
      : roundMoney(contractValue / 1.19);
  }

  if (advanceBaseIncludesIva === true) {
    return contractValue ?? confirmedContractBase ?? confirmedCoverageBase;
  }

  return confirmedContractBase ?? contractValue ?? confirmedCoverageBase;
}

function extractAdvanceBaseAmount(source: string | null | undefined) {
  if (!source) {
    return null;
  }

  const normalized = normalizeBaseValue(source);
  const baseMarkers = [
    "subtotal",
    "valor sin iva",
    "sin incluir iva",
    "antes de iva",
    "valor estimado sin",
  ];

  if (!baseMarkers.some((marker) => normalized.includes(marker))) {
    return null;
  }

  const sentences = source
    .replace(/\n+/g, ". ")
    .split(/(?<=[.!?;:])\s+/)
    .filter((sentence) => {
      const normalizedSentence = normalizeBaseValue(sentence);
      return baseMarkers.some((marker) => normalizedSentence.includes(marker));
    });

  for (const sentence of sentences) {
    const amount = Array.from(sentence.matchAll(/\$\s*[\d.,]+/g))
      .map((match) => normalizeNumber(match[0]))
      .find((value): value is number => value !== null);

    if (amount !== undefined) {
      return amount;
    }
  }

  const amounts = Array.from(source.matchAll(/\$\s*[\d.,]+/g))
    .map((match) => normalizeNumber(match[0]))
    .filter((amount): amount is number => amount !== null);

  return amounts.length > 0
    ? amounts.sort((left, right) => right - left)[0]
    : null;
}

function extractAdvancePercentage(source: string | null | undefined) {
  const normalized = normalizeBaseValue(source);

  if (!normalized.includes("anticipo")) {
    return null;
  }

  const sentences = normalized
    .split(/(?<=[.!?;:])\s+/)
    .filter((sentence) => sentence.includes("anticipo"));
  const preferredSentences = sentences.filter((sentence) =>
    [
      "valor estimado",
      "sin incluir iva",
      "sin iva",
      "procedimiento de pago",
      "forma de pago",
      "pago anticipado",
      "anticipo del",
    ].some((marker) => sentence.includes(marker)),
  );
  const candidates = [...preferredSentences, ...sentences, normalized]
    .map((text) => extractPercentageValue(text))
    .filter((value): value is number => value !== null);

  return candidates.find((value) => value > 0 && value < 1) ?? null;
}

function extractPercentageValue(text: string) {
  const numericPercent = text.match(/(\d+(?:[.,]\d+)?)\s*%/);

  if (numericPercent) {
    const value = normalizeNumber(numericPercent[1]);
    return value === null ? null : value / 100;
  }

  if (text.includes("veinte por ciento")) {
    return 0.2;
  }

  if (text.includes("treinta por ciento")) {
    return 0.3;
  }

  if (text.includes("cincuenta por ciento")) {
    return 0.5;
  }

  if (text.includes("cien por ciento")) {
    return 1;
  }

  return null;
}

function inferAdvanceBaseIncludesIva(source: string | null | undefined) {
  const normalized = normalizeBaseValue(source);

  if (
    normalized.includes("sin incluir iva") ||
    normalized.includes("sin iva") ||
    normalized.includes("antes de iva") ||
    normalized.includes("no incluye iva")
  ) {
    return false;
  }

  if (
    normalized.includes("incluido iva") ||
    normalized.includes("iva incluido") ||
    normalized.includes("incluye iva")
  ) {
    return true;
  }

  return null;
}

function buildCivilLiabilitySubcoverages(
  coverage: CoverageInput,
  insuredValue: number | null,
): CoverageSubamparo[] {
  const page = coverage.fuente_pagina ?? null;
  const source = coverage.fuente_texto ?? null;
  const contractSublimitPercent = extractCivilLiabilitySublimitPercent(source);
  const templateSource =
    "El contrato exige el amparo, pero no define cuantía individual. El 50% proviene de la plantilla de liquidación.";
  const informationalPercent = contractSublimitPercent ?? 0.5;
  const informationalOrigin: CoverageSubamparo["origen"] = contractSublimitPercent === null
    ? "regla_plantilla_afisec"
    : "contrato";
  const informationalSource = contractSublimitPercent === null
    ? templateSource
    : source;
  const informationalRequiresReview = contractSublimitPercent === null;

  const defaults: CoverageSubamparo[] = [
    {
      nombre: "PLO",
      incluido: true,
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
    ...getDefaultCivilLiabilitySubcoverageNames(source).map((name) => ({
      nombre: name,
      incluido: true,
      porcentaje_sublimite: informationalPercent,
      valor_sublimite:
        insuredValue === null ? null : roundMoney(insuredValue * informationalPercent),
      origen: informationalOrigin,
      calculable: false,
      requiere_revision: informationalRequiresReview,
      fuente_texto: informationalSource,
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
    const percentage = isPlo
      ? 1
      : normalizeSubcoveragePercent(
          subamparo.porcentaje_sublimite ??
            current?.porcentaje_sublimite ??
            null,
        );
    const valueFromPercentage =
      !isPlo && percentage !== null && insuredValue !== null
        ? roundMoney(insuredValue * percentage)
        : null;

    byKey.set(key, {
      nombre:
        current?.nombre ??
        getCanonicalCivilLiabilitySubcoverageName(subamparo.nombre),
      incluido: subamparo.incluido,
      porcentaje_sublimite: percentage,
      valor_sublimite:
        isPlo
          ? insuredValue
          : valueFromPercentage ??
            subamparo.valor_sublimite ??
            current?.valor_sublimite ??
            null,
      origen: isPlo ? "contrato" : subamparo.origen,
      calculable: isPlo,
      requiere_revision: subamparo.requiere_revision,
      fuente_texto: subamparo.fuente_texto ?? current?.fuente_texto ?? null,
      fuente_pagina: subamparo.fuente_pagina ?? current?.fuente_pagina ?? null,
    });
  });

  return Array.from(byKey.values());
}

function normalizeSubcoveragePercent(value: number | null | undefined) {
  const normalized = normalizeNumber(value);

  if (normalized === null) {
    return null;
  }

  if (normalized > 1 && normalized <= 100) {
    return normalized / 100;
  }

  return normalized;
}

function getCanonicalCivilLiabilitySubcoverageName(name: string) {
  const key = getCivilLiabilitySubcoverageKey(name);
  const names: Record<string, string> = {
    plo: "PLO",
    contratistas_subcontratistas: "Contratistas y subcontratistas",
    rc_patronal: "RC Patronal",
    rc_cruzada: "RC Cruzada",
    vehiculos_propios_no_propios: "Vehículos propios y no propios",
    gastos_medicos: "Gastos médicos",
    contaminacion_ambiental: "Responsabilidad por contaminación ambiental",
    dano_emergente_lucro_cesante: "Daño emergente y lucro cesante",
    perjuicios_extrapatrimoniales: "Perjuicios extrapatrimoniales",
  };

  return names[key] ?? name;
}

function getDefaultCivilLiabilitySubcoverageNames(source: string | null) {
  const defaults = [
    "Contratistas y subcontratistas",
    "RC Patronal",
    "RC Cruzada",
    "Vehículos propios y no propios",
  ];
  const normalizedSource = normalizeBaseValue(source);
  const frequent = [
    {
      name: "Vehículos propios y no propios",
      markers: ["vehiculos propios", "vehiculos no propios"],
    },
    { name: "Gastos médicos", markers: ["gastos medicos"] },
    {
      name: "Responsabilidad por contaminación ambiental",
      markers: ["contaminacion ambiental", "contaminación ambiental"],
    },
    {
      name: "Daño emergente y lucro cesante",
      markers: ["dano emergente", "daño emergente", "lucro cesante"],
    },
    {
      name: "Perjuicios extrapatrimoniales",
      markers: ["extrapatrimoniales", "perjuicios extrapatrimoniales"],
    },
  ];

  for (const item of frequent) {
    if (
      item.markers.some((marker) =>
        normalizedSource.includes(normalizeBaseValue(marker)),
      ) &&
      !defaults.some((name) => getCivilLiabilitySubcoverageKey(name) === getCivilLiabilitySubcoverageKey(item.name))
    ) {
      defaults.push(item.name);
    }
  }

  return defaults;
}

function extractCivilLiabilitySublimitPercent(source: string | null) {
  const normalized = normalizeBaseValue(source);

  if (
    !normalized.includes("plo") ||
    !(
      normalized.includes("cada uno") ||
      normalized.includes("estos amparos") ||
      normalized.includes("amparos adicionales") ||
      normalized.includes("cada amparo")
    )
  ) {
    return null;
  }

  const numericPercent = normalized.match(/(\d+(?:[.,]\d+)?)\s*%/);

  if (numericPercent) {
    const value = normalizeNumber(numericPercent[1]);
    return value === null ? null : value / 100;
  }

  if (normalized.includes("treinta por ciento")) {
    return 0.3;
  }

  if (normalized.includes("cincuenta por ciento")) {
    return 0.5;
  }

  if (normalized.includes("cien por ciento")) {
    return 1;
  }

  return null;
}

function calculateStartDate(
  coverage: CoverageInput,
  contract: ContractCoverageContext,
  reasons: Set<string>,
  explicitStartDate: string | null,
  manualStartDateEnabled: boolean,
) {
  if (manualStartDateEnabled) {
    if (explicitStartDate !== null) {
      return explicitStartDate;
    }

    reasons.add("La fecha inicio manual del amparo está incompleta o no es válida.");
    return null;
  }

  if (explicitStartDate !== null) {
    return explicitStartDate;
  }

  if (isPayrollCoverage(coverage.tipo_amparo, coverage.fuente_texto)) {
    if (contract.fechaInicio) {
      return contract.fechaInicio;
    }

    reasons.add("Falta fecha inicio del contrato para calcular fecha desde.");
    return null;
  }

  if (coverage.tipo_vigencia === "post_contractual") {
    return resolveCoverageEndBaseDate(coverage, contract, reasons);
  }

  if (coverage.tipo_vigencia === "contractual") {
    if (contract.fechaInicio) {
      return contract.fechaInicio;
    }

    reasons.add("Falta fecha inicio del contrato para calcular fecha desde.");
    return null;
  }

  if (isClosureBasedPostContractualCoverage(coverage)) {
    return resolveCoverageEndBaseDate(coverage, contract, reasons);
  }

  if (
    (isContractEndBasedCoverage(coverage) ||
      isPayrollCoverage(coverage.tipo_amparo, coverage.fuente_texto)) &&
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
  explicitStartDate: string | null,
  explicitEndDate: string | null,
  manualStartDateEnabled: boolean,
  manualEndDateEnabled: boolean,
) {
  if (manualEndDateEnabled) {
    if (explicitEndDate !== null) {
      return explicitEndDate;
    }

    reasons.add("La fecha fin manual del amparo está incompleta o no es válida.");
    return null;
  }

  if (explicitEndDate !== null) {
    return explicitEndDate;
  }

  const additionalDays = getEffectiveAdditionalDays(coverage);
  const endBaseDate = resolveCoverageEndBaseDate(coverage, contract, reasons);

  if (endBaseDate !== null) {
    return addDays(endBaseDate, additionalDays ?? 0);
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

function resolveCoverageEndBaseDate(
  coverage: CoverageInput,
  contract: ContractCoverageContext,
  reasons: Set<string>,
) {
  const normalizedBase = normalizeBaseVigencia(coverage.base_vigencia);

  if (
    coverage.tipo_vigencia === "contractual" &&
    normalizedBase === "fecha_inicio_contrato"
  ) {
    if (contract.fechaFin) {
      return contract.fechaFin;
    }

    reasons.add("Falta fecha fin del contrato para calcular fecha hasta.");
    return null;
  }

  if (normalizedBase === "fecha_inicio_contrato") {
    if (contract.fechaInicio) {
      return contract.fechaInicio;
    }

    reasons.add("Falta fecha inicio del contrato para calcular la base de vigencia.");
    return null;
  }

  if (normalizedBase === "fecha_fin_contrato") {
    if (contract.fechaFin) {
      return contract.fechaFin;
    }

    reasons.add("Falta fecha fin del contrato para calcular fecha hasta.");
    return null;
  }

  if (normalizedBase === "acta_recibo_final") {
    if (contract.fechaFin) {
      reasons.add(
        "La fecha del Acta de Recibo Final no está disponible; se usa la fecha fin del contrato como estimación para cotización.",
      );
      return contract.fechaFin;
    }

    reasons.add("Falta fecha fin del contrato para estimar el Acta de Recibo Final.");
    return null;
  }

  if (normalizedBase === "firma_contrato") {
    reasons.add("Falta fecha de firma del contrato para calcular la vigencia.");
    return null;
  }

  if (normalizedBase === "otra") {
    reasons.add("La base de vigencia marcada como otra requiere revisión manual.");
    return null;
  }

  if (
    isContractEndBasedCoverage(coverage) ||
    coverage.tipo_vigencia === "contractual" ||
    coverage.tipo_vigencia === "post_contractual" ||
    isClosureBasedPostContractualCoverage(coverage) ||
    isPayrollCoverage(coverage.tipo_amparo, coverage.fuente_texto)
  ) {
    if (contract.fechaFin) {
      return contract.fechaFin;
    }

    reasons.add("Falta fecha fin del contrato para calcular fecha hasta.");
    return null;
  }

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

  const days = diffDaysDateOnly(startsAt, endsAt);

  if (days === null) {
    reasons.add("Hay fechas inválidas para calcular días de vigencia.");
    return null;
  }

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

function calculatePremiumFromNet({
  netPremium,
  ivaPercentage,
}: {
  netPremium: number;
  ivaPercentage: number;
}) {
  const normalizedNetPremium = roundMoney(netPremium);
  const tax = roundMoney(normalizedNetPremium * ivaPercentage);

  return {
    prima_neta: normalizedNetPremium,
    impuesto: tax,
    prima_total: roundMoney(normalizedNetPremium + tax),
  };
}

function getEffectiveAdditionalDays(coverage: CoverageInput) {
  const additionalDays = normalizeNumber(coverage.dias_adicionales);

  if (additionalDays !== null) {
    return Math.trunc(additionalDays);
  }

  if (isPayrollCoverage(coverage.tipo_amparo, coverage.fuente_texto)) {
    return 1095;
  }

  if (isClosureBasedPostContractualCoverage(coverage)) {
    return extractPostContractualDays(coverage.fuente_texto) ?? 30;
  }

  if (coverage.tipo_vigencia === "contractual") {
    return 0;
  }

  if (isContractEndBasedCoverage(coverage)) {
    return 30;
  }

  if (coverage.tipo_vigencia === "post_contractual") {
    return 0;
  }

  return null;
}

function extractPostContractualDays(source: string | null | undefined) {
  const normalized = normalizeBaseValue(source);

  if (!normalized) {
    return null;
  }

  const numericDays =
    normalized.match(/\((\d+)\)\s*dias?/) ??
    normalized.match(/(\d+)\s*dias?/);

  if (numericDays) {
    const days = normalizeNumber(numericDays[1]);
    return days === null ? null : Math.trunc(days);
  }

  const numericYears =
    normalized.match(/\((\d+)\)\s*anos?/) ??
    normalized.match(/(\d+)\s*anos?/);

  if (numericYears) {
    const years = normalizeNumber(numericYears[1]);
    return years === null ? null : Math.trunc(years * 365);
  }

  const numericMonths =
    normalized.match(/\((\d+)\)\s*mes(?:es)?/) ??
    normalized.match(/(\d+)\s*mes(?:es)?/);

  if (numericMonths) {
    const months = normalizeNumber(numericMonths[1]);
    return months === null ? null : Math.trunc(months * 30);
  }

  if (
    normalized.includes("un ano") ||
    normalized.includes("un (1) ano") ||
    normalized.includes("uno (1) ano")
  ) {
    return 365;
  }

  if (normalized.includes("tres anos") || normalized.includes("tres (3) anos")) {
    return 1095;
  }

  if (normalized.includes("tres meses") || normalized.includes("tres (3) meses")) {
    return 90;
  }

  return null;
}

function resolveCoverageValidityBase(
  coverage: CoverageInput,
  contract: ContractCoverageContext,
  explicitStartDate: string | null,
  explicitEndDate: string | null,
  reasons: Set<string>,
): CoverageValidityBase {
  if (explicitStartDate !== null || explicitEndDate !== null) {
    return "fecha_explicita";
  }

  const normalizedBase = normalizeBaseVigencia(coverage.base_vigencia);

  if (
    normalizedBase === "fecha_inicio_contrato" ||
    normalizedBase === "fecha_fin_contrato" ||
    normalizedBase === "acta_recibo_final" ||
    normalizedBase === "firma_contrato"
  ) {
    return normalizedBase;
  }

  if (normalizedBase === "otra") {
    reasons.add("La base de vigencia marcada como otra requiere revisión manual.");
    return "no_determinada";
  }

  if (isClosureBasedPostContractualCoverage(coverage)) {
    return "acta_recibo_final";
  }

  if (isContractEndBasedCoverage(coverage)) {
    return "fecha_fin_contrato";
  }

  if (normalizedBase === "no_determinada") {
    reasons.add("No se pudo determinar la base de vigencia.");
    return "no_determinada";
  }

  if (coverage.tipo_vigencia === "contractual" ||
      coverage.tipo_vigencia === "post_contractual") {
    if (contract.fechaFin) {
      return "fecha_fin_contrato";
    }

    reasons.add("No se pudo determinar la base de vigencia.");
    return "no_determinada";
  }

  reasons.add("No se pudo determinar la base de vigencia.");
  return "no_determinada";
}

function normalizeBaseVigencia(value: string | null | undefined) {
  const normalized = (normalizeText(value, null) ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (!normalized) {
    return null;
  }

  const allowedValues: CoverageValidityBase[] = [
    "fecha_inicio_contrato",
    "fecha_fin_contrato",
    "acta_recibo_final",
    "fecha_explicita",
    "no_determinada",
    "firma_contrato",
    "otra",
  ];

  return (
    allowedValues.find(
      (allowed) => normalizeBaseValue(allowed) === normalized,
    ) ??
    null
  );
}

function isContractEndBasedCoverage(coverage: CoverageInput) {
  return (
    isComplianceCoverage(coverage) ||
    isAdvancePaymentCoverage(coverage) ||
    isPayrollCoverage(coverage.tipo_amparo, coverage.fuente_texto) ||
    isCivilLiabilityCoverage(coverage.tipo_amparo, coverage.fuente_texto) ||
    isPersonalAccidentCoverage(coverage) ||
    isMedicalExpenseCoverage(coverage) ||
    isFuneralAidCoverage(coverage)
  );
}

function isAdvancePaymentCoverage(coverage: CoverageInput) {
  return coverageTextIncludes(coverage, [
    "buen manejo de anticipo",
    "buen manejo del anticipo",
    "buen manejo y correcta inversion",
    "correcta inversion del anticipo",
    "correcta inversión del anticipo",
    "amortizacion del anticipo",
    "amortización del anticipo",
    "buen_manejo_anticipo",
  ]);
}

function isComplianceCoverage(coverage: CoverageInput) {
  return coverageTextIncludes(coverage, ["cumplimiento"]);
}

function isPersonalAccidentCoverage(coverage: CoverageInput) {
  return coverageTextIncludes(coverage, [
    "accidentes personales",
    "accidente personal",
  ]);
}

function isMedicalExpenseCoverage(coverage: CoverageInput) {
  return coverageTextIncludes(coverage, [
    "gastos medicos",
    "gastos medicos y auxilio funerario",
    "gastos medicos y funeral",
  ]);
}

function isFuneralAidCoverage(coverage: CoverageInput) {
  return coverageTextIncludes(coverage, [
    "auxilio funerario",
    "gastos funerarios",
    "funerario",
  ]);
}

function isServiceQualityCoverage(coverage: CoverageInput) {
  return coverageTextIncludes(coverage, [
    "calidad del servicio",
    "calidad de servicio",
    "calidad de la obra",
    "calidad obra",
    "estabilidad de obra",
    "estabilidad y calidad",
  ]);
}

function isContractualTermPlusAdditionalCoverage(coverage: CoverageInput) {
  const text = normalizeBaseValue(
    `${coverage.tipo_amparo ?? ""} ${coverage.fuente_texto ?? ""}`,
  );

  if (!text) {
    return false;
  }

  const mentionsFullContractTerm =
    text.includes("vigencia igual al termino") ||
    text.includes("vigencia igual al plazo") ||
    text.includes("vigencia igual a la duracion") ||
    text.includes("vigencia igual a la duración") ||
    text.includes("plazo de ejecucion") ||
    text.includes("plazo de ejecución") ||
    text.includes("termino de vigencia del contrato") ||
    text.includes("término de vigencia del contrato") ||
    text.includes("duracion del contrato") ||
    text.includes("duración del contrato");
  const mentionsAdditionalPeriod =
    text.includes(" mas") ||
    text.includes(" más") ||
    text.includes("adicional") ||
    /\+\s*\d+/.test(text);

  return mentionsFullContractTerm && mentionsAdditionalPeriod;
}

function isClosureBasedPostContractualCoverage(coverage: CoverageInput) {
  if (isPayrollCoverage(coverage.tipo_amparo, coverage.fuente_texto)) {
    return false;
  }

  if (isContractualTermPlusAdditionalCoverage(coverage)) {
    return false;
  }

  return (
    isServiceQualityCoverage(coverage) ||
    normalizeBaseVigencia(coverage.base_vigencia) === "acta_recibo_final" ||
    coverageTextIncludes(coverage, [
      "a partir del acta de recibo final",
      "desde el acta de recibo final",
      "acta de recibo final",
      "acta de cierre",
      "a partir de la terminacion del contrato",
      "a partir de la terminación del contrato",
    ])
  );
}

function isPayrollCoverage(
  type: string | null | undefined,
  source: string | null | undefined,
) {
  return coverageTextIncludes(
    { tipo_amparo: type ?? "", fuente_texto: source ?? null },
    ["salarios", "prestaciones"],
  );
}

function coverageTextIncludes(
  coverage: Pick<CoverageInput, "tipo_amparo" | "fuente_texto">,
  markers: string[],
) {
  const text = normalizeBaseValue(
    `${coverage.tipo_amparo ?? ""} ${coverage.fuente_texto ?? ""}`,
  );

  if (!text) {
    return false;
  }

  return markers.some((marker) => text.includes(marker));
}

function normalizeBaseValue(value: string | null | undefined) {
  const text = normalizeText(value, null);

  if (text === null) {
    return "";
  }

  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function addDays(date: string, days: number) {
  return addDaysToDateOnly(date, days) ?? date;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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

  if (
    normalized.includes("plo") ||
    normalized.includes("predios") ||
    (normalized.includes("labores") && normalized.includes("operaciones"))
  ) {
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

  if (normalized.includes("dano emergente") || normalized.includes("lucro cesante")) {
    return "dano_emergente_lucro_cesante";
  }

  if (normalized.includes("extrapatrimonial")) {
    return "perjuicios_extrapatrimoniales";
  }

  if (normalized.includes("contaminacion")) {
    return "contaminacion_ambiental";
  }

  if (normalized.includes("gastos medicos")) {
    return "gastos_medicos";
  }

  if (normalized.includes("propios") && normalized.includes("no propios")) {
    return "vehiculos_propios_no_propios";
  }

  if (normalized.includes("no propios")) {
    return "vehiculos_propios_no_propios";
  }

  if (normalized.includes("propios")) {
    return "vehiculos_propios_no_propios";
  }

  if (normalized.includes("vehicul")) {
    return "vehiculos_propios_no_propios";
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
    "según corresponda",
    "segun corresponda",
  ].some((marker) => source.toLowerCase().includes(marker));
}
