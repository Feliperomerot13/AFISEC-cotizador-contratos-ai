import { waitUntil } from "@vercel/functions";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { processContract } from "@/lib/processing";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type IdContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, { params }: IdContext) {
  try {
    const { id } = await params;
    const supabase = getSupabaseAdmin();
    const { data: otrosiDocument, error: otrosiDocumentError } = await supabase
      .from("documentos")
      .select("id")
      .eq("contrato_id", id)
      .eq("tipo_documento", "otrosi")
      .order("fecha_carga", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (otrosiDocumentError) {
      throw new Error(
        `No se pudo validar el tipo de documento: ${otrosiDocumentError.message}`,
      );
    }

    if (otrosiDocument) {
      const { data: activeIssuedQuote, error: activeIssuedQuoteError } =
        await supabase
          .from("cotizaciones")
          .select("id")
          .eq("contrato_id", id)
          .eq("estado", "emitida")
          .maybeSingle();

      if (activeIssuedQuoteError) {
        throw new Error(
          `Fallo al validar póliza emitida: ${activeIssuedQuoteError.message}`,
        );
      }

      if (!activeIssuedQuote) {
        return jsonError(
          "Los otrosíes estarán disponibles cuando exista una póliza base emitida.",
          409,
        );
      }
    }

    const { error } = await supabase
      .from("contratos")
      .update({
        estado: "procesando",
        mensaje_error: null,
      })
      .eq("id", id);

    if (error) {
      throw new Error(`No se pudo iniciar el procesamiento: ${error.message}`);
    }

    const processing = processContract(id);

    if (process.env.VERCEL === "1") {
      waitUntil(processing);
      return jsonOk({ status: "procesando" });
    }

    await processing;
    return jsonOk({ status: "procesado" });
  } catch (error) {
    return jsonError(getErrorMessage(error));
  }
}
