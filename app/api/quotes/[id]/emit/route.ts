import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type IdContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, { params }: IdContext) {
  try {
    const { id } = await params;
    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();

    const { data: quote, error: quoteError } = await supabase
      .from("cotizaciones")
      .select("id,contrato_id,estado")
      .eq("id", id)
      .single();

    if (quoteError || !quote) {
      return jsonError(
        `No se encontró la cotización: ${quoteError?.message ?? "sin detalle"}`,
        404,
      );
    }

    if (quote.estado === "emitida") {
      return jsonOk({ quote });
    }

    if (quote.estado !== "generada") {
      return jsonError(
        "Solo una cotización generada puede marcarse como emitida.",
        409,
      );
    }

    const { data: activeIssuedQuote, error: activeIssuedQuoteError } =
      await supabase
        .from("cotizaciones")
        .select("id,numero_cotizacion,version")
        .eq("contrato_id", quote.contrato_id)
        .eq("estado", "emitida")
        .neq("id", id)
        .maybeSingle();

    if (activeIssuedQuoteError) {
      throw new Error(
        `Fallo al validar emisión activa: ${activeIssuedQuoteError.message}`,
      );
    }

    if (activeIssuedQuote) {
      return jsonError(
        `Ya existe una póliza emitida activa para este contrato: ${activeIssuedQuote.numero_cotizacion} v${activeIssuedQuote.version}.`,
        409,
      );
    }

    const { data: emittedQuote, error: updateError } = await supabase
      .from("cotizaciones")
      .update({
        estado: "emitida",
        fecha_emision: now,
        fecha_reversion: null,
        motivo_reversion: null,
        actualizado_en: now,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (updateError || !emittedQuote) {
      throw new Error(
        `Fallo al emitir la póliza base: ${updateError?.message ?? "sin detalle"}`,
      );
    }

    return jsonOk({ quote: emittedQuote });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
