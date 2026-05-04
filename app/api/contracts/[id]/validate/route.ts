import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { normalizeCoverage } from "@/lib/coverage-calculations";
import type { Json } from "@/lib/database.types";
import { validateContractSchema } from "@/lib/schemas";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type IdContext = {
  params: Promise<{ id: string }>;
};

export async function PUT(request: Request, { params }: IdContext) {
  try {
    const { id } = await params;
    const payload = validateContractSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("contratos")
      .update({
        ...payload.contrato,
        estado: "validado",
        mensaje_error: null,
        validado_por: payload.validado_por,
        fecha_validacion: now,
      })
      .eq("id", id);

    if (updateError) {
      throw new Error(
        `Fallo al guardar la validación: ${updateError.message}`,
      );
    }

    const { error: deleteError } = await supabase
      .from("amparos")
      .delete()
      .eq("contrato_id", id);

    if (deleteError) {
      throw new Error(
        `Fallo al reemplazar los amparos: ${deleteError.message}`,
      );
    }

    if (payload.amparos.length > 0) {
      const { error: insertError } = await supabase.from("amparos").insert(
        payload.amparos.map((amparo) => {
          const normalized = normalizeCoverage(
            {
              ...amparo,
              confianza: amparo.confianza ?? "baja",
            },
            {
              valorContrato: payload.contrato.valor_contrato,
              fechaInicio: payload.contrato.fecha_inicio,
              fechaFin: payload.contrato.fecha_fin,
            },
          );
          const reviewReasons = [
            amparo.motivo_revision,
            normalized.motivo_revision,
          ]
            .filter(Boolean)
            .join(" ");

          return {
            contrato_id: id,
            modificacion_id: null,
            tasa_referencia_id: null,
            tipo_amparo: normalized.tipo_amparo,
            porcentaje: normalized.porcentaje,
            cuantia_fija: normalized.cuantia_fija,
            valor_base_calculo: normalized.valor_base_calculo,
            modo_calculo: normalized.modo_calculo,
            valor_asegurado: normalized.valor_asegurado,
            tasa: normalized.tasa,
            dias_vigencia: normalized.dias_vigencia,
            iva_porcentaje: normalized.iva_porcentaje,
            prima_neta: normalized.prima_neta,
            impuesto: normalized.impuesto,
            prima_total: normalized.prima_total,
            tasa_manual: normalized.tasa_manual,
            tipo_vigencia: normalized.tipo_vigencia,
            base_vigencia: normalized.base_vigencia,
            fecha_desde: normalized.fecha_desde,
            fecha_hasta: normalized.fecha_hasta,
            dias_adicionales: normalized.dias_adicionales,
            fuente_pagina: amparo.fuente_pagina,
            fuente_texto: amparo.fuente_texto,
            confianza: normalized.confianza,
            requiere_revision:
              amparo.requiere_revision || normalized.requiere_revision,
            motivo_revision: reviewReasons || null,
            subamparos: normalized.subamparos as Json,
          };
        }),
      );

      if (insertError) {
        throw new Error(`Fallo al guardar amparos: ${insertError.message}`);
      }
    }

    return jsonOk({ status: "validado" });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
