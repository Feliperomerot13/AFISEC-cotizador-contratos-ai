import { z } from "zod";
import { CONTRACT_STATES, DOCUMENT_TYPES, EXECUTIVES } from "@/lib/constants";
import {
  normalizeCurrency,
  normalizeDate,
  normalizeBoolean,
  normalizeInteger,
  normalizeNumber,
  normalizeText,
} from "@/lib/normalizers";

const confidenceSchema = z.enum(["alta", "media", "baja"]);
const coverageValidityTypeSchema = z.enum(["contractual", "post_contractual"]);
const coverageValidityBaseSchema = z.enum([
  "fecha_inicio_contrato",
  "fecha_fin_contrato",
  "acta_recibo_final",
  "fecha_explicita",
  "no_determinada",
  "firma_contrato",
  "otra",
]);
const pageSchema = z.number().int().positive().nullable();
const sourceSchema = z.string().nullable();
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();
const subcoverageSchema = z.object({
  nombre: z.string(),
  incluido: z.boolean().default(true),
  porcentaje_sublimite: z.number().nullable(),
  valor_sublimite: z.number().nullable(),
  origen: z.enum(["contrato", "regla_plantilla_afisec"]),
  calculable: z.boolean(),
  requiere_revision: z.boolean(),
  fuente_texto: z.string().nullable(),
  fuente_pagina: z.number().int().positive().nullable(),
});

const sourcedValueSchema = z
  .object({
    valor: z.string().nullable(),
    confianza: confidenceSchema,
    pagina: pageSchema,
    fuente: sourceSchema,
  })
  .strict();

const sourcedNumberSchema = z
  .object({
    valor: z.number().nonnegative().nullable(),
    confianza: confidenceSchema,
    pagina: pageSchema,
    fuente: sourceSchema,
  })
  .strict();

const sourcedIntegerSchema = z
  .object({
    valor: z.number().int().nonnegative().nullable(),
    confianza: confidenceSchema,
    pagina: pageSchema,
    fuente: sourceSchema,
  })
  .strict();

const sourcedBooleanSchema = z
  .object({
    valor: z.boolean().nullable(),
    confianza: confidenceSchema,
    pagina: pageSchema,
    fuente: sourceSchema,
  })
  .strict();

const sourcedDateSchema = z
  .object({
    valor: dateSchema,
    confianza: confidenceSchema,
    pagina: pageSchema,
    fuente: sourceSchema,
  })
  .strict();

const guaranteeSchema = z
  .object({
    tipo_amparo: z.string().min(1),
    porcentaje: z.number().nonnegative().nullable(),
    cuantia_fija: z.number().nonnegative().nullable(),
    valor_asegurado: z.number().nonnegative().nullable(),
    tipo_vigencia: coverageValidityTypeSchema.nullable(),
    base_vigencia: coverageValidityBaseSchema.nullable(),
    dias_adicionales: z.number().int().nonnegative().nullable(),
    fecha_desde: dateSchema,
    fecha_hasta: dateSchema,
    fuente_texto: sourceSchema,
    fuente_pagina: pageSchema,
    confianza: confidenceSchema,
    subamparos: z.array(subcoverageSchema).default([]),
  })
  .strict();

export const aiExtractionSchema = z
  .object({
    numero_contrato: sourcedValueSchema,
    tipo_contrato: z
      .object({
        valor: z.enum(["estatal", "particular"]).nullable(),
        confianza: confidenceSchema,
        pagina: pageSchema,
        fuente: sourceSchema,
      })
      .strict(),
    contratante: z
      .object({
        nombre: z.string().nullable(),
        nit: z.string().nullable(),
        confianza: confidenceSchema,
        pagina: pageSchema,
        fuente: sourceSchema,
      })
      .strict(),
    contratista: z
      .object({
        nombre: z.string().nullable(),
        nit: z.string().nullable(),
        confianza: confidenceSchema,
        pagina: pageSchema,
        fuente: sourceSchema,
      })
      .strict(),
    objeto: sourcedValueSchema,
    valor_contrato: z
      .object({
        valor_numerico: z.number().nonnegative().nullable(),
        moneda: z.string().nullable(),
        confianza: confidenceSchema,
        pagina: pageSchema,
        fuente: sourceSchema,
      })
      .strict(),
    fecha_inicio: z
      .object({
        valor: dateSchema,
        confianza: confidenceSchema,
        pagina: pageSchema,
        fuente: sourceSchema,
      })
      .strict(),
    fecha_fin: sourcedDateSchema,
    plazo: sourcedValueSchema,
    garantias: z.array(guaranteeSchema),
    campos_no_encontrados: z.array(z.string()),
    alertas: z.array(z.string()),
  })
  .strict();

export type AIExtraction = z.infer<typeof aiExtractionSchema>;
export const amendmentExtractionSchema = z
  .object({
    numero_modificacion: sourcedValueSchema,
    tipo_modificacion: sourcedValueSchema,
    contrato_afectado: sourcedValueSchema,
    fecha_firma: sourcedDateSchema,
    valor_contrato_anterior: sourcedNumberSchema,
    valor_adicion: sourcedNumberSchema,
    valor_adicion_total: sourcedNumberSchema.default({
      valor: null,
      confianza: "baja",
      pagina: null,
      fuente: null,
    }),
    valor_adicion_unitario: sourcedNumberSchema.default({
      valor: null,
      confianza: "baja",
      pagina: null,
      fuente: null,
    }),
    periodicidad_valor_adicion: sourcedValueSchema.default({
      valor: null,
      confianza: "baja",
      pagina: null,
      fuente: null,
    }),
    numero_periodos_adicionados: sourcedIntegerSchema.default({
      valor: null,
      confianza: "baja",
      pagina: null,
      fuente: null,
    }),
    periodos_adicionados: z.array(z.string()).default([]),
    requiere_multiplicacion: sourcedBooleanSchema.default({
      valor: null,
      confianza: "baja",
      pagina: null,
      fuente: null,
    }),
    explicacion_calculo_valor_adicion: sourcedValueSchema.default({
      valor: null,
      confianza: "baja",
      pagina: null,
      fuente: null,
    }),
    valor_contrato_acumulado: sourcedNumberSchema,
    fecha_desde: sourcedDateSchema,
    fecha_hasta: sourcedDateSchema,
    dias_prorroga: sourcedIntegerSchema,
    objeto_nuevo: sourcedValueSchema,
    requiere_ajuste_garantias: z
      .object({
        valor: z.boolean().nullable(),
        confianza: confidenceSchema,
        pagina: pageSchema,
        fuente: sourceSchema,
      })
      .strict(),
    impuesto_timbre: sourcedValueSchema,
    fuente_texto: sourceSchema,
    fuente_pagina: pageSchema,
    confianza: confidenceSchema,
    requiere_revision: z.boolean(),
    motivo_revision: z.string().nullable(),
    garantias: z.array(guaranteeSchema),
    campos_no_encontrados: z.array(z.string()),
    alertas: z.array(z.string()),
  })
  .strict();

export type AmendmentExtraction = z.infer<typeof amendmentExtractionSchema>;
export type AIConfidence = z.infer<typeof confidenceSchema>;
export type AICoverageValidityType = z.infer<
  typeof coverageValidityTypeSchema
>;
export type AICoverageValidityBase = z.infer<
  typeof coverageValidityBaseSchema
>;

const requiredTrimmedString = (minLength: number, message: string) =>
  z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string().min(minLength, message),
  );

const emptyToNullString = z.preprocess((value) => {
  return normalizeText(value);
}, z.string().nullable());

const nullableNumber = z.preprocess((value) => {
  return normalizeNumber(value);
}, z.number().nonnegative().nullable());

const nullableInteger = z.preprocess((value) => {
  return normalizeInteger(value);
}, z.number().int().nonnegative().nullable());

const nullableDateString = z.preprocess((value) => {
  return normalizeDate(value);
}, dateSchema);

const nullableBoolean = z.preprocess((value) => {
  if (value === null || typeof value === "undefined" || value === "") {
    return null;
  }

  return normalizeBoolean(value, false);
}, z.boolean().nullable());

const currencyString = z.preprocess((value) => {
  return normalizeCurrency(value);
}, z.string().min(1));

const emptyToNullCoverageValidityType = z.preprocess((value) => {
  if (typeof value === "string" && value.trim() === "") {
    return null;
  }

  return value;
}, coverageValidityTypeSchema.nullable());

const emptyToNullCoverageValidityBase = z.preprocess((value) => {
  if (typeof value === "string" && value.trim() === "") {
    return null;
  }

  return value;
}, coverageValidityBaseSchema.nullable());

export const uploadFormSchema = z.object({
  nombreCliente: requiredTrimmedString(
    2,
    "El nombre del cliente es obligatorio.",
  ),
  nitCliente: requiredTrimmedString(3, "El NIT del cliente es obligatorio."),
  ejecutivo: z.enum(EXECUTIVES),
  tipoDocumento: z.enum(DOCUMENT_TYPES),
  contratoBaseId: z.string().regex(/^\d+$/).optional(),
});

export const validateContractSchema = z.object({
  validado_por: z.enum(EXECUTIVES),
  contrato: z.object({
    numero_contrato: emptyToNullString,
    objeto: emptyToNullString,
    tipo_contrato: z.enum(["estatal", "particular"]).nullable(),
    valor_contrato: nullableNumber,
    base_calculo_amparos: nullableNumber,
    base_calculo_incluye_iva: nullableBoolean,
    moneda: currencyString,
    fecha_inicio: nullableDateString,
    fecha_fin: nullableDateString,
    plazo: emptyToNullString,
    renovable_automaticamente: z.boolean().default(false),
    contratante: emptyToNullString,
    contratante_nit: emptyToNullString,
    contratista: emptyToNullString,
    contratista_nit: emptyToNullString,
  }),
  amparos: z.array(
    z.object({
      id: z.coerce.number().int().positive().optional(),
      tipo_amparo: requiredTrimmedString(
        1,
        "El tipo de amparo es obligatorio.",
      ),
      porcentaje: nullableNumber,
      cuantia_fija: nullableNumber,
      valor_base_calculo: nullableNumber,
      modo_calculo: emptyToNullString,
      valor_asegurado: nullableNumber,
      tasa: nullableNumber,
      dias_vigencia: nullableInteger,
      iva_porcentaje: nullableNumber,
      prima_neta: nullableNumber,
      impuesto: nullableNumber,
      prima_total: nullableNumber,
      tasa_manual: z.boolean().default(false),
      tipo_vigencia: emptyToNullCoverageValidityType,
      base_vigencia: emptyToNullCoverageValidityBase,
      fecha_desde: nullableDateString,
      fecha_hasta: nullableDateString,
      dias_adicionales: nullableInteger,
      fuente_pagina: nullableInteger,
      fuente_texto: emptyToNullString,
      confianza: confidenceSchema.nullable(),
      requiere_revision: z.boolean().default(false),
      motivo_revision: emptyToNullString,
      subamparos: z.array(subcoverageSchema).default([]),
    }),
  ),
});

export const contractListQuerySchema = z.object({
  ejecutivo: z.enum(EXECUTIVES).optional(),
  estado: z.enum(CONTRACT_STATES).optional(),
  search: z.string().optional(),
  vencen: z.enum(["30"]).optional(),
});

const nullableRateRecord = z.record(
  z.string(),
  z.preprocess((value) => normalizeNumber(value), z.number().nonnegative().nullable()),
);

export const amendmentReviewSchema = z.object({
  numero_modificacion: emptyToNullString,
  tipo_modificacion: emptyToNullString,
  fecha_firma: nullableDateString,
  valor_contrato_anterior: nullableNumber,
  valor_adicion: nullableNumber,
  valor_contrato_acumulado: nullableNumber,
  fecha_desde: nullableDateString,
  fecha_hasta: nullableDateString,
  dias_prorroga: nullableInteger,
  objeto_nuevo: emptyToNullString,
  requiere_ajuste_garantias: z.boolean().default(true),
  observaciones: emptyToNullString,
  tasas: nullableRateRecord.default({}),
});

export const amendmentCloseSchema = z.object({
  estado: z.enum(["anulado", "no_aplicable"]),
  motivo: z.preprocess(
    (value) => normalizeText(value),
    z.string().min(3, "Debes registrar un motivo."),
  ),
});

export const amendmentQuoteRevertSchema = z.object({
  motivo: z.preprocess(
    (value) => normalizeText(value) ?? "Reversión operativa del otrosí",
    z.string().min(3),
  ),
});

export type ValidateContractPayload = z.infer<typeof validateContractSchema>;
export type AmendmentReviewPayload = z.infer<typeof amendmentReviewSchema>;
