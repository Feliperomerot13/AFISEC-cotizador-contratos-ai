import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import {
  activeStateToJson,
  buildResultingActiveState,
  calculateAmendmentLiquidation,
  isTerminalAmendmentState,
  liquidationToJson,
} from "@/lib/amendments";
import { loadAmendmentContext } from "@/lib/amendment-context";
import { amendmentReviewSchema } from "@/lib/schemas";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type IdContext = {
  params: Promise<{ id: string }>;
};

export async function PUT(request: Request, { params }: IdContext) {
  try {
    const { id } = await params;
    const payload = amendmentReviewSchema.parse(await request.json());
    const context = await loadAmendmentContext(id);

    if (context.modification.estado === "endoso_emitido") {
      return jsonError("Un otrosí emitido no puede editarse directamente.", 409);
    }

    if (isTerminalAmendmentState(context.modification.estado)) {
      return jsonError(
        "Este otrosí ya está cerrado. Crea o procesa el siguiente otrosí desde el estado vigente.",
        409,
      );
    }

    const now = new Date().toISOString();
    const reviewedModification = {
      ...context.modification,
      numero_modificacion: payload.numero_modificacion,
      tipo_modificacion: payload.tipo_modificacion,
      fecha_firma: payload.fecha_firma,
      valor_contrato_anterior: payload.valor_contrato_anterior,
      valor_adicion: payload.valor_adicion,
      valor_contrato_acumulado: payload.valor_contrato_acumulado,
      fecha_desde: payload.fecha_desde,
      fecha_hasta: payload.fecha_hasta,
      dias_prorroga: payload.dias_prorroga,
      objeto_nuevo: payload.objeto_nuevo,
      requiere_ajuste_garantias: payload.requiere_ajuste_garantias,
      motivo_revision: payload.observaciones,
    };
    const liquidation = calculateAmendmentLiquidation({
      activeState: context.activeState,
      modification: reviewedModification,
      rateOverrides: payload.tasas,
      generatedAt: now,
    });
    const resultingState = buildResultingActiveState({
      activeState: context.activeState,
      modification: reviewedModification,
      quoteId: "pendiente",
      quoteNumber: "Pendiente",
      version: 0,
      liquidation,
    });
    const { data: modification, error: updateError } = await getSupabaseAdmin()
      .from("modificaciones_contractuales")
      .update({
        numero_modificacion: payload.numero_modificacion,
        tipo_modificacion: payload.tipo_modificacion,
        fecha_firma: payload.fecha_firma,
        valor_contrato_anterior: payload.valor_contrato_anterior,
        valor_adicion: payload.valor_adicion,
        valor_contrato_acumulado: payload.valor_contrato_acumulado,
        fecha_desde: payload.fecha_desde,
        fecha_hasta: payload.fecha_hasta,
        dias_prorroga: payload.dias_prorroga,
        objeto_nuevo: payload.objeto_nuevo,
        requiere_ajuste_garantias: payload.requiere_ajuste_garantias,
        motivo_revision: payload.observaciones,
        requiere_revision: false,
        estado: "validado",
        liquidacion: liquidationToJson(liquidation),
        snapshot_vigente_anterior: activeStateToJson(context.activeState),
        snapshot_vigente_resultante: activeStateToJson(resultingState),
        actualizado_en: now,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (updateError || !modification) {
      throw new Error(
        `Fallo al guardar revisión del otrosí: ${updateError?.message ?? "sin detalle"}`,
      );
    }

    return jsonOk({ modification });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
