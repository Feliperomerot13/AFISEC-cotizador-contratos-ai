import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { canDeleteGeneratedQuote } from "@/lib/quotes";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type IdContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_request: Request, { params }: IdContext) {
  try {
    const { id } = await params;
    const supabase = getSupabaseAdmin();
    const { data: quote, error: quoteError } = await supabase
      .from("cotizaciones")
      .select(
        "id,estado,fecha_emision,fecha_reversion,pdf_bucket,pdf_path,numero_cotizacion,version",
      )
      .eq("id", id)
      .single();

    if (quoteError || !quote) {
      return jsonError(
        `No se encontró la cotización: ${quoteError?.message ?? "sin detalle"}`,
        404,
      );
    }

    if (!canDeleteGeneratedQuote(quote)) {
      return jsonError(
        "Solo se pueden eliminar cotizaciones generadas que nunca fueron emitidas ni revertidas.",
        409,
      );
    }

    const { error: deleteError } = await supabase
      .from("cotizaciones")
      .delete()
      .eq("id", id)
      .eq("estado", "generada")
      .is("fecha_emision", null)
      .is("fecha_reversion", null);

    if (deleteError) {
      throw new Error(`Fallo al eliminar la cotización: ${deleteError.message}`);
    }

    if (quote.pdf_bucket && quote.pdf_path) {
      const { error: storageError } = await supabase.storage
        .from(quote.pdf_bucket)
        .remove([quote.pdf_path]);

      if (storageError) {
        return jsonError(
          `La cotización fue eliminada de la base, pero no se pudo borrar el PDF en Storage: ${storageError.message}`,
          500,
        );
      }
    }

    return jsonOk({
      deleted: true,
      quote: {
        id: quote.id,
        numero_cotizacion: quote.numero_cotizacion,
        version: quote.version,
      },
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
