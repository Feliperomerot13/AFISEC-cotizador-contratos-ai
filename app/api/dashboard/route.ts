import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    const [total, pending, quotes, issuedPolicies] = await Promise.all([
      supabase
        .from("contratos")
        .select("id", { count: "exact", head: true }),
      supabase
        .from("contratos")
        .select("id", { count: "exact", head: true })
        .eq("estado", "pendiente_validacion"),
      supabase
        .from("cotizaciones")
        .select("id", { count: "exact", head: true })
        .in("estado", ["generada", "emitida", "emision_revertida", "anulada"]),
      supabase
        .from("cotizaciones")
        .select("id", { count: "exact", head: true })
        .eq("estado", "emitida"),
    ]);

    const firstError =
      total.error ?? pending.error ?? quotes.error ?? issuedPolicies.error;

    if (firstError) {
      throw new Error(`Fallo al consultar indicadores: ${firstError.message}`);
    }

    return jsonOk({
      total: total.count ?? 0,
      pendingValidation: pending.count ?? 0,
      quotesGenerated: quotes.count ?? 0,
      issuedPolicies: issuedPolicies.count ?? 0,
    });
  } catch (error) {
    return jsonError(getErrorMessage(error));
  }
}
