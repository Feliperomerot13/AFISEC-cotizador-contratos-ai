import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { getAmendmentQuoteSnapshot } from "@/lib/amendments";
import { amendmentQuoteRevertSchema } from "@/lib/schemas";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type IdContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: IdContext) {
  try {
    const { id } = await params;
    const payload = amendmentQuoteRevertSchema.parse(await request.json());
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

    if (quote.estado !== "endoso_emitido") {
      return jsonError("Solo un otrosí emitido puede reversarse.", 409);
    }

    const { data: activeEndorsements, error: activeEndorsementsError } =
      await supabase
        .from("cotizaciones_ajuste")
        .select("*")
        .eq("contrato_id", quote.contrato_id)
        .eq("estado", "endoso_emitido")
        .order("fecha_emision", { ascending: true });

    if (activeEndorsementsError) {
      throw new Error(
        `Fallo al validar último otrosí emitido: ${activeEndorsementsError.message}`,
      );
    }

    const sortedActive = (activeEndorsements ?? []).sort((left, right) => {
      const leftSnapshot = getAmendmentQuoteSnapshot(left);
      const rightSnapshot = getAmendmentQuoteSnapshot(right);

      return (
        (leftSnapshot?.modificacion.secuencia ?? 0) -
        (rightSnapshot?.modificacion.secuencia ?? 0)
      );
    });
    const latestActive = sortedActive.at(-1) ?? null;

    if (!latestActive || String(latestActive.id) !== String(quote.id)) {
      return jsonError(
        "Solo se puede reversar la emisión del último otrosí del contrato.",
        409,
      );
    }

    const now = new Date().toISOString();
    const { data: revertedQuote, error: updateQuoteError } = await supabase
      .from("cotizaciones_ajuste")
      .update({
        estado: "emision_revertida",
        fecha_reversion: now,
        motivo_reversion: payload.motivo,
        actualizado_en: now,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (updateQuoteError || !revertedQuote) {
      throw new Error(
        `Fallo al reversar emisión del otrosí: ${updateQuoteError?.message ?? "sin detalle"}`,
      );
    }

    const { error: updateModificationError } = await supabase
      .from("modificaciones_contractuales")
      .update({
        estado: "cotizado",
        aplicada_en: null,
        motivo_anulacion: payload.motivo,
        actualizado_en: now,
      })
      .eq("id", quote.modificacion_id);

    if (updateModificationError) {
      throw new Error(
        `Fallo al actualizar otrosí reversado: ${updateModificationError.message}`,
      );
    }

    return jsonOk({ quote: revertedQuote });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
