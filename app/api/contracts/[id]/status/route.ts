import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type IdContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: IdContext) {
  try {
    const { id } = await params;
    const { data, error } = await getSupabaseAdmin()
      .from("contratos")
      .select("id,estado,mensaje_error,fecha_procesamiento,fecha_validacion")
      .eq("id", id)
      .single();

    if (error || !data) {
      return jsonError(
        `No se encontró el estado del contrato: ${error?.message ?? "sin detalle"}`,
        404,
      );
    }

    return jsonOk(data);
  } catch (error) {
    return jsonError(getErrorMessage(error));
  }
}
