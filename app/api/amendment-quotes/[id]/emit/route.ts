import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import {
  NON_TERMINAL_AMENDMENT_STATES,
  activeStateToJson,
  amendmentSnapshotToJson,
  buildResultingActiveState,
  getBasePolicyEndorsementIssues,
  getAmendmentQuoteSnapshot,
} from "@/lib/amendments";
import { loadAmendmentContext } from "@/lib/amendment-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type IdContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, { params }: IdContext) {
  try {
    const { id } = await params;
    const supabase = getSupabaseAdmin();
    const { data: quote, error: quoteError } = await supabase
      .from("cotizaciones_ajuste")
      .select("*")
      .eq("id", id)
      .single();

    if (quoteError || !quote) {
      return jsonError(
        `No se encontró la cotización de ajuste: ${quoteError?.message ?? "sin detalle"}`,
        404,
      );
    }

    if (quote.estado === "endoso_emitido") {
      return jsonOk({ quote });
    }

    if (quote.estado !== "generada") {
      return jsonError(
        "Solo una cotización de ajuste generada puede emitirse como otrosí.",
        409,
      );
    }

    const context = await loadAmendmentContext(quote.modificacion_id);

    if (!["cotizado", "validado"].includes(context.modification.estado)) {
      return jsonError(
        "El otrosí debe estar revisado y cotizado antes de emitirse.",
        409,
      );
    }

    const basePolicyIssues = getBasePolicyEndorsementIssues({
      activeState: context.activeState,
      baseQuote: context.baseQuote,
      contract: context.contract,
    });

    if (basePolicyIssues.length > 0) {
      return jsonError(
        [
          "No se puede emitir el otrosí porque la póliza base emitida está incompleta.",
          ...basePolicyIssues,
        ].join(" "),
        422,
      );
    }

    const { data: activeForModification, error: activeForModificationError } =
      await supabase
        .from("cotizaciones_ajuste")
        .select("id,numero_cotizacion,version")
        .eq("modificacion_id", quote.modificacion_id)
        .eq("estado", "endoso_emitido")
        .neq("id", id)
        .maybeSingle();

    if (activeForModificationError) {
      throw new Error(
        `Fallo al validar otrosí activo: ${activeForModificationError.message}`,
      );
    }

    if (activeForModification) {
      return jsonError(
        `Ya existe un otrosí emitido para este registro: ${activeForModification.numero_cotizacion} v${activeForModification.version}.`,
        409,
      );
    }

    const { data: previousPending, error: previousPendingError } = await supabase
      .from("modificaciones_contractuales")
      .select("id,numero_modificacion,estado,secuencia")
      .eq("contrato_id", context.modification.contrato_id)
      .lt("secuencia", context.modification.secuencia ?? 1)
      .in("estado", [...NON_TERMINAL_AMENDMENT_STATES])
      .limit(1);

    if (previousPendingError) {
      throw new Error(
        `Fallo al validar secuencia previa: ${previousPendingError.message}`,
      );
    }

    if (previousPending?.[0]) {
      return jsonError(
        `No se puede emitir este otrosí porque el otrosí ${previousPending[0].numero_modificacion ?? previousPending[0].secuencia} sigue en revisión.`,
        409,
      );
    }

    const snapshot = getAmendmentQuoteSnapshot(quote);

    if (!snapshot) {
      return jsonError("La cotización de ajuste no tiene snapshot válido.", 422);
    }

    const now = new Date().toISOString();
    const resultingState = buildResultingActiveState({
      activeState: snapshot.estado_vigente_anterior,
      modification: context.modification,
      quoteId: quote.id,
      quoteNumber: quote.numero_cotizacion,
      version: quote.version,
      liquidation: snapshot.liquidacion,
    });
    const emittedSnapshot = {
      ...snapshot,
      estado_vigente_resultante: resultingState,
    };
    const { data: emittedQuote, error: updateQuoteError } = await supabase
      .from("cotizaciones_ajuste")
      .update({
        estado: "endoso_emitido",
        fecha_emision: now,
        fecha_reversion: null,
        motivo_reversion: null,
        snapshot: amendmentSnapshotToJson(emittedSnapshot),
        actualizado_en: now,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (updateQuoteError || !emittedQuote) {
      throw new Error(
        `Fallo al emitir otrosí: ${updateQuoteError?.message ?? "sin detalle"}`,
      );
    }

    const { error: updateModificationError } = await supabase
      .from("modificaciones_contractuales")
      .update({
        estado: "endoso_emitido",
        aplicada_en: now,
        snapshot_vigente_anterior: activeStateToJson(snapshot.estado_vigente_anterior),
        snapshot_vigente_resultante: activeStateToJson(resultingState),
        actualizado_en: now,
      })
      .eq("id", quote.modificacion_id);

    if (updateModificationError) {
      throw new Error(
        `Fallo al actualizar otrosí emitido: ${updateModificationError.message}`,
      );
    }

    return jsonOk({ quote: emittedQuote });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
