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

export type Database = {
  public: {
    Tables: {
      clientes: TableDefinition<
        {
          id: string;
          nombre: string;
          nit: string;
          ejecutivo: string;
          creado_en: string;
          actualizado_en: string;
        },
        {
          id?: string;
          nombre: string;
          nit: string;
          ejecutivo: string;
          creado_en?: string;
          actualizado_en?: string;
        }
      >;
      contratos: TableDefinition<
        {
          id: string;
          cliente_id: string;
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
          id?: string;
          cliente_id: string;
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
          id: string;
          contrato_id: string;
          nombre_archivo: string;
          storage_bucket: string;
          storage_path: string;
          mime_type: string;
          size_bytes: number;
          tipo_documento: string;
          fecha_carga: string;
          actualizado_en: string;
        },
        {
          id?: string;
          contrato_id: string;
          nombre_archivo: string;
          storage_bucket: string;
          storage_path: string;
          mime_type: string;
          size_bytes: number;
          tipo_documento: string;
          fecha_carga?: string;
          actualizado_en?: string;
        }
      >;
      amparos: TableDefinition<
        {
          id: string;
          contrato_id: string;
          modificacion_id: string | null;
          tasa_referencia_id: string | null;
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
          id?: string;
          contrato_id: string;
          modificacion_id?: string | null;
          tasa_referencia_id?: string | null;
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
          id: string;
          contrato_id: string;
          documento_id: string | null;
          modelo: string | null;
          version_prompt: string;
          texto_extraido: string | null;
          json_original: Json;
          campos_no_encontrados: Json;
          alertas: Json;
          tokens_entrada: number;
          tokens_salida: number;
          costo_estimado: number;
          resultado: string;
          mensaje_error: string | null;
          fecha_extraccion: string;
        },
        {
          id?: string;
          contrato_id: string;
          documento_id?: string | null;
          modelo?: string | null;
          version_prompt?: string | null;
          texto_extraido?: string | null;
          json_original?: Json;
          campos_no_encontrados?: Json;
          alertas?: Json;
          tokens_entrada?: number;
          tokens_salida?: number;
          costo_estimado?: number;
          resultado: string;
          mensaje_error?: string | null;
          fecha_extraccion?: string;
        }
      >;
      modificaciones_contractuales: TableDefinition<
        {
          id: string;
          contrato_id: string;
          documento_id: string | null;
          numero_modificacion: string | null;
          tipo_modificacion: string | null;
          valor_adicion: number | null;
          valor_contrato_acumulado: number | null;
          fecha_desde: string | null;
          fecha_hasta: string | null;
          dias_prorroga: number | null;
          fuente_pagina: number | null;
          fuente_texto: string | null;
          confianza: string | null;
          requiere_revision: boolean;
          motivo_revision: string | null;
          creado_en: string;
          actualizado_en: string;
        },
        {
          id?: string;
          contrato_id: string;
          documento_id?: string | null;
          numero_modificacion?: string | null;
          tipo_modificacion?: string | null;
          valor_adicion?: number | null;
          valor_contrato_acumulado?: number | null;
          fecha_desde?: string | null;
          fecha_hasta?: string | null;
          dias_prorroga?: number | null;
          fuente_pagina?: number | null;
          fuente_texto?: string | null;
          confianza?: string | null;
          requiere_revision?: boolean;
          motivo_revision?: string | null;
          creado_en?: string;
          actualizado_en?: string;
        }
      >;
      tasas_referencia: TableDefinition<{
        id: string;
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
export type TasaReferencia =
  Database["public"]["Tables"]["tasas_referencia"]["Row"];
