export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type TableDefinition<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type DbInt8 = number | string;

export type Database = {
  public: {
    Tables: {
      clientes: TableDefinition<
        {
          id: DbInt8;
          nombre: string;
          nit: string | null;
          ejecutivo: string;
          creado_en: string;
          actualizado_en: string;
        },
        {
          id?: DbInt8;
          nombre: string;
          nit?: string | null;
          ejecutivo: string;
          creado_en?: string;
          actualizado_en?: string;
        }
      >;
      contratos: TableDefinition<
        {
          id: DbInt8;
          cliente_id: DbInt8 | null;
          numero_contrato: string | null;
          objeto: string | null;
          tipo_contrato: string | null;
          valor_contrato: number | null;
          base_calculo_amparos: number | null;
          base_calculo_incluye_iva: boolean | null;
          moneda: string;
          fecha_inicio: string | null;
          fecha_fin: string | null;
          plazo: string | null;
          renovable_automaticamente: boolean;
          contratante: string | null;
          contratante_nit: string | null;
          contratista: string | null;
          contratista_nit: string | null;
          estado: string;
          mensaje_error: string | null;
          extraido_ia: boolean;
          validado_por: string | null;
          fecha_procesamiento: string | null;
          fecha_validacion: string | null;
          version_prompt: string;
          creado_en: string;
          actualizado_en: string;
        },
        {
          id?: DbInt8;
          cliente_id?: DbInt8 | null;
          numero_contrato?: string | null;
          objeto?: string | null;
          tipo_contrato?: string | null;
          valor_contrato?: number | null;
          base_calculo_amparos?: number | null;
          base_calculo_incluye_iva?: boolean | null;
          moneda?: string;
          fecha_inicio?: string | null;
          fecha_fin?: string | null;
          plazo?: string | null;
          renovable_automaticamente?: boolean;
          contratante?: string | null;
          contratante_nit?: string | null;
          contratista?: string | null;
          contratista_nit?: string | null;
          estado: string;
          mensaje_error?: string | null;
          extraido_ia?: boolean;
          validado_por?: string | null;
          fecha_procesamiento?: string | null;
          fecha_validacion?: string | null;
          version_prompt?: string;
          creado_en?: string;
          actualizado_en?: string;
        }
      >;
      documentos: TableDefinition<
        {
          id: DbInt8;
          contrato_id: DbInt8 | null;
          nombre_archivo: string;
          storage_bucket: string;
          storage_path: string;
          mime_type: string | null;
          size_bytes: number | null;
          tipo_documento: string;
          fecha_carga: string;
          actualizado_en: string;
        },
        {
          id?: DbInt8;
          contrato_id?: DbInt8 | null;
          nombre_archivo: string;
          storage_bucket: string;
          storage_path: string;
          mime_type?: string | null;
          size_bytes?: number | null;
          tipo_documento: string;
          fecha_carga?: string;
          actualizado_en?: string;
        }
      >;
      amparos: TableDefinition<
        {
          id: DbInt8;
          contrato_id: DbInt8;
          modificacion_id: DbInt8 | null;
          tasa_referencia_id: DbInt8 | null;
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
          confianza: string | null;
          requiere_revision: boolean;
          motivo_revision: string | null;
          subamparos: Json;
          creado_en: string;
          actualizado_en: string;
        },
        {
          id?: DbInt8;
          contrato_id: DbInt8;
          modificacion_id?: DbInt8 | null;
          tasa_referencia_id?: DbInt8 | null;
          tipo_amparo: string;
          porcentaje?: number | null;
          cuantia_fija?: number | null;
          valor_base_calculo?: number | null;
          modo_calculo?: string | null;
          valor_asegurado?: number | null;
          tasa?: number | null;
          dias_vigencia?: number | null;
          iva_porcentaje?: number;
          prima_neta?: number | null;
          impuesto?: number | null;
          prima_total?: number | null;
          tasa_manual?: boolean;
          tipo_vigencia?: string | null;
          base_vigencia?: string | null;
          fecha_desde?: string | null;
          fecha_hasta?: string | null;
          dias_adicionales?: number | null;
          fuente_pagina?: number | null;
          fuente_texto?: string | null;
          confianza?: string | null;
          requiere_revision?: boolean;
          motivo_revision?: string | null;
          subamparos?: Json;
          creado_en?: string;
          actualizado_en?: string;
        }
      >;
      extracciones: TableDefinition<
        {
          id: DbInt8;
          contrato_id: DbInt8 | null;
          documento_id: DbInt8 | null;
          modelo: string | null;
          version_prompt: string;
          texto_extraido: string | null;
          json_original: Json;
          campos_no_encontrados: Json;
          alertas: Json;
          tokens_entrada: number;
          tokens_salida: number;
          costo_estimado: number;
          resultado: string | null;
          mensaje_error: string | null;
          fecha_extraccion: string;
        },
        {
          id?: DbInt8;
          contrato_id?: DbInt8 | null;
          documento_id?: DbInt8 | null;
          modelo?: string | null;
          version_prompt?: string | null;
          texto_extraido?: string | null;
          json_original?: Json;
          campos_no_encontrados?: Json;
          alertas?: Json;
          tokens_entrada?: number;
          tokens_salida?: number;
          costo_estimado?: number;
          resultado?: string | null;
          mensaje_error?: string | null;
          fecha_extraccion?: string;
        }
      >;
      modificaciones_contractuales: TableDefinition<
        {
          id: DbInt8;
          contrato_id: DbInt8;
          documento_id: DbInt8 | null;
          numero_modificacion: string | null;
          tipo_modificacion: string | null;
          valor_adicion: number | null;
          valor_contrato_acumulado: number | null;
          valor_contrato_anterior: number | null;
          fecha_desde: string | null;
          fecha_hasta: string | null;
          fecha_firma: string | null;
          dias_prorroga: number | null;
          fuente_pagina: number | null;
          fuente_texto: string | null;
          confianza: string | null;
          requiere_revision: boolean;
          motivo_revision: string | null;
          estado: string;
          objeto_anterior: string | null;
          objeto_nuevo: string | null;
          requiere_ajuste_garantias: boolean;
          secuencia: number | null;
          cotizacion_base_id: DbInt8 | null;
          endoso_anterior_id: DbInt8 | null;
          snapshot_vigente_anterior: Json | null;
          snapshot_vigente_resultante: Json | null;
          alertas: Json;
          campos_no_encontrados: Json;
          liquidacion: Json;
          alerta_secuencia: string | null;
          aplicada_en: string | null;
          aplicado_por: string | null;
          fecha_anulacion: string | null;
          motivo_anulacion: string | null;
          creado_en: string;
          actualizado_en: string;
        },
        {
          id?: DbInt8;
          contrato_id: DbInt8;
          documento_id?: DbInt8 | null;
          numero_modificacion?: string | null;
          tipo_modificacion?: string | null;
          valor_adicion?: number | null;
          valor_contrato_acumulado?: number | null;
          valor_contrato_anterior?: number | null;
          fecha_desde?: string | null;
          fecha_hasta?: string | null;
          fecha_firma?: string | null;
          dias_prorroga?: number | null;
          fuente_pagina?: number | null;
          fuente_texto?: string | null;
          confianza?: string | null;
          requiere_revision?: boolean;
          motivo_revision?: string | null;
          estado?: string;
          objeto_anterior?: string | null;
          objeto_nuevo?: string | null;
          requiere_ajuste_garantias?: boolean;
          secuencia?: number | null;
          cotizacion_base_id?: DbInt8 | null;
          endoso_anterior_id?: DbInt8 | null;
          snapshot_vigente_anterior?: Json | null;
          snapshot_vigente_resultante?: Json | null;
          alertas?: Json;
          campos_no_encontrados?: Json;
          liquidacion?: Json;
          alerta_secuencia?: string | null;
          aplicada_en?: string | null;
          aplicado_por?: string | null;
          fecha_anulacion?: string | null;
          motivo_anulacion?: string | null;
          creado_en?: string;
          actualizado_en?: string;
        }
      >;
      cotizaciones: TableDefinition<
        {
          id: DbInt8;
          contrato_id: DbInt8;
          numero_cotizacion: string;
          version: number;
          estado: string;
          snapshot: Json;
          total_prima_neta: number | null;
          total_iva: number | null;
          total_prima: number | null;
          pdf_bucket: string | null;
          pdf_path: string | null;
          pdf_nombre_archivo: string | null;
          fecha_generacion: string;
          fecha_emision: string | null;
          fecha_reversion: string | null;
          motivo_reversion: string | null;
          creado_en: string;
          actualizado_en: string;
        },
        {
          id?: DbInt8;
          contrato_id: DbInt8;
          numero_cotizacion: string;
          version: number;
          estado?: string;
          snapshot: Json;
          total_prima_neta?: number | null;
          total_iva?: number | null;
          total_prima?: number | null;
          pdf_bucket?: string | null;
          pdf_path?: string | null;
          pdf_nombre_archivo?: string | null;
          fecha_generacion?: string;
          fecha_emision?: string | null;
          fecha_reversion?: string | null;
          motivo_reversion?: string | null;
          creado_en?: string;
          actualizado_en?: string;
        },
        {
          id?: DbInt8;
          contrato_id?: DbInt8;
          numero_cotizacion?: string;
          version?: number;
          estado?: string;
          snapshot?: Json;
          total_prima_neta?: number | null;
          total_iva?: number | null;
          total_prima?: number | null;
          pdf_bucket?: string | null;
          pdf_path?: string | null;
          pdf_nombre_archivo?: string | null;
          fecha_generacion?: string;
          fecha_emision?: string | null;
          fecha_reversion?: string | null;
          motivo_reversion?: string | null;
          creado_en?: string;
          actualizado_en?: string;
        }
      >;
      cotizaciones_ajuste: TableDefinition<
        {
          id: DbInt8;
          contrato_id: DbInt8;
          modificacion_id: DbInt8;
          numero_cotizacion: string;
          version: number;
          estado: string;
          snapshot: Json;
          total_prima_neta: number | null;
          total_iva: number | null;
          total_prima: number | null;
          pdf_bucket: string | null;
          pdf_path: string | null;
          pdf_nombre_archivo: string | null;
          fecha_generacion: string;
          fecha_emision: string | null;
          fecha_reversion: string | null;
          motivo_reversion: string | null;
          creado_en: string;
          actualizado_en: string;
        },
        {
          id?: DbInt8;
          contrato_id: DbInt8;
          modificacion_id: DbInt8;
          numero_cotizacion: string;
          version: number;
          estado?: string;
          snapshot: Json;
          total_prima_neta?: number | null;
          total_iva?: number | null;
          total_prima?: number | null;
          pdf_bucket?: string | null;
          pdf_path?: string | null;
          pdf_nombre_archivo?: string | null;
          fecha_generacion?: string;
          fecha_emision?: string | null;
          fecha_reversion?: string | null;
          motivo_reversion?: string | null;
          creado_en?: string;
          actualizado_en?: string;
        },
        {
          id?: DbInt8;
          contrato_id?: DbInt8;
          modificacion_id?: DbInt8;
          numero_cotizacion?: string;
          version?: number;
          estado?: string;
          snapshot?: Json;
          total_prima_neta?: number | null;
          total_iva?: number | null;
          total_prima?: number | null;
          pdf_bucket?: string | null;
          pdf_path?: string | null;
          pdf_nombre_archivo?: string | null;
          fecha_generacion?: string;
          fecha_emision?: string | null;
          fecha_reversion?: string | null;
          motivo_reversion?: string | null;
          creado_en?: string;
          actualizado_en?: string;
        }
      >;
      tasas_referencia: TableDefinition<{
        id: DbInt8;
        aseguradora: string;
        tipo_amparo: string;
        tasa: number;
        retro_max_dias: number | null;
        vigente: boolean;
        notas: string | null;
        creado_en: string;
        actualizado_en: string;
      }>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Cliente = Database["public"]["Tables"]["clientes"]["Row"];
export type Contrato = Database["public"]["Tables"]["contratos"]["Row"];
export type Documento = Database["public"]["Tables"]["documentos"]["Row"];
export type Amparo = Database["public"]["Tables"]["amparos"]["Row"];
export type ModificacionContractual =
  Database["public"]["Tables"]["modificaciones_contractuales"]["Row"];
export type Cotizacion = Database["public"]["Tables"]["cotizaciones"]["Row"];
export type CotizacionAjuste =
  Database["public"]["Tables"]["cotizaciones_ajuste"]["Row"];
export type TasaReferencia =
  Database["public"]["Tables"]["tasas_referencia"]["Row"];
