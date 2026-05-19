import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type IdContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: IdContext) {
  try {
    const { id } = await params;
    const body = await readJsonBody(request);
    const motivo = normalizeReason(body.motivo);
    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();

    const { data: quote, error: quoteError } = await supabase
      .from("cotizaciones")
      .select("id,estado")
      .eq("id", id)
      .single();

    if (quoteError || !quote) {
      return jsonError(
        `No se encontró la cotización: ${quoteError?.message ?? "sin detalle"}`,
        404,
      );
    }

    if (quote.estado !== "emitida") {
      return jsonError("Solo una emisión activa puede revertirse.", 409);
    }

    const { data: revertedQuote, error: updateError } = await supabase
      .from("cotizaciones")
      .update({
        estado: "emision_revertida",
        fecha_reversion: now,
        motivo_reversion: motivo,
        actualizado_en: now,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (updateError || !revertedQuote) {
      throw new Error(
        `Fallo al revertir la emisión: ${updateError?.message ?? "sin detalle"}`,
      );
    }

    return jsonOk({ quote: revertedQuote });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}

async function readJsonBody(request: Request) {
  try {
    return (await request.json()) as { motivo?: unknown };
  } catch {
    return {};
  }
}

function normalizeReason(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : "Reversión operativa de emisión";
}
