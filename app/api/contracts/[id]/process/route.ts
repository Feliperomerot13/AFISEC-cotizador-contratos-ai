import { waitUntil } from "@vercel/functions";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { processAmendmentDocument, processContract } from "@/lib/processing";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type IdContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, { params }: IdContext) {
  try {
    const { id } = await params;
    const supabase = getSupabaseAdmin();
    const { data: latestDocument, error: latestDocumentError } = await supabase
      .from("documentos")
      .select("id,tipo_documento")
      .eq("contrato_id", id)
      .order("fecha_carga", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestDocumentError) {
      throw new Error(
        `No se pudo validar el tipo de documento: ${latestDocumentError.message}`,
      );
    }

    if (latestDocument?.tipo_documento === "otrosi") {
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
          "Solo se puede procesar un otrosí cuando exista una póliza base emitida.",
          409,
        );
      }

      const processing = processAmendmentDocument({
        contratoId: id,
        documentoId: latestDocument.id,
      });

      const modification = await processing;
      return jsonOk({ status: "otrosi_procesado", modification });
    }

    const { data: baseContract, error: baseContractError } = await supabase
      .from("contratos")
      .select("origen")
      .eq("id", id)
      .maybeSingle();

    if (baseContractError) {
      throw new Error(
        `No se pudo validar el contrato: ${baseContractError.message}`,
      );
    }

    if (baseContract?.origen === "manual" || !latestDocument) {
      return jsonError(
        "Esta cotización se creó sin documento y no se procesa con IA.",
        409,
      );
    }

    const { data: issuedBaseQuote, error: issuedBaseQuoteError } = await supabase
      .from("cotizaciones")
      .select("id")
      .eq("contrato_id", id)
      .eq("estado", "emitida")
      .maybeSingle();

    if (issuedBaseQuoteError) {
      throw new Error(
        `Fallo al validar póliza emitida: ${issuedBaseQuoteError.message}`,
      );
    }

    if (issuedBaseQuote) {
      return jsonError(
        "La póliza base emitida bloquea el reprocesamiento del contrato.",
        409,
      );
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
