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
    const { error } = await getSupabaseAdmin()
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
