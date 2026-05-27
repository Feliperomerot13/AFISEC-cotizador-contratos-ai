import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { amendmentCloseSchema } from "@/lib/schemas";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type IdContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: IdContext) {
  try {
    const { id } = await params;
    const payload = amendmentCloseSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();
    const { data: modification, error: modificationError } = await supabase
      .from("modificaciones_contractuales")
      .select("id,estado")
      .eq("id", id)
      .single();

    if (modificationError || !modification) {
      return jsonError(
        `No se encontró el otrosí: ${modificationError?.message ?? "sin detalle"}`,
        404,
      );
    }

    if (modification.estado === "endoso_emitido") {
      return jsonError(
        "Un otrosí emitido debe reversarse desde la cotización de ajuste emitida.",
        409,
      );
    }

    const now = new Date().toISOString();
    const { data: issuedQuotes, error: issuedQuotesError } = await supabase
      .from("cotizaciones_ajuste")
      .select("id")
      .eq("modificacion_id", id)
      .in("estado", ["endoso_emitido", "emision_revertida"])
      .limit(1);

    if (issuedQuotesError) {
      throw new Error(
        `Fallo al validar trazabilidad del otrosí: ${issuedQuotesError.message}`,
      );
    }

    if (issuedQuotes?.[0]) {
      return jsonError(
        "Un otrosí que ya fue emitido conserva trazabilidad y no puede eliminarse.",
        409,
      );
    }

    const { error: quoteUpdateError } = await supabase
      .from("cotizaciones_ajuste")
      .update({
        estado: "anulada",
        fecha_reversion: now,
        motivo_reversion: payload.motivo,
        actualizado_en: now,
      })
      .eq("modificacion_id", id)
      .neq("estado", "endoso_emitido");

    if (quoteUpdateError) {
      throw new Error(
        `Fallo al limpiar cotizaciones de ajuste del otrosí: ${quoteUpdateError.message}`,
      );
    }

    const { data: updated, error: updateError } = await supabase
      .from("modificaciones_contractuales")
      .update({
        estado: payload.estado,
        fecha_anulacion: now,
        motivo_anulacion: payload.motivo,
        actualizado_en: now,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (updateError || !updated) {
      throw new Error(
        `Fallo al cerrar el otrosí: ${updateError?.message ?? "sin detalle"}`,
      );
    }

    return jsonOk({ modification: updated });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
