import { EXPIRATION_WINDOW_DAYS } from "@/lib/constants";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const today = new Date();
    const expirationLimit = new Date(today);
    expirationLimit.setDate(today.getDate() + EXPIRATION_WINDOW_DAYS);

    const todayIso = today.toISOString().slice(0, 10);
    const limitIso = expirationLimit.toISOString().slice(0, 10);

    const [total, pending, errors, upcoming] = await Promise.all([
      supabase
        .from("contratos")
        .select("id", { count: "exact", head: true }),
      supabase
        .from("contratos")
        .select("id", { count: "exact", head: true })
        .eq("estado", "pendiente_validacion"),
      supabase
        .from("contratos")
        .select("id", { count: "exact", head: true })
        .eq("estado", "error"),
      supabase
        .from("contratos")
        .select("id", { count: "exact", head: true })
        .gte("fecha_fin", todayIso)
        .lte("fecha_fin", limitIso),
    ]);

    const firstError =
      total.error ?? pending.error ?? errors.error ?? upcoming.error;

    if (firstError) {
      throw new Error(`Fallo al consultar indicadores: ${firstError.message}`);
    }

    return jsonOk({
      total: total.count ?? 0,
      pendingValidation: pending.count ?? 0,
      errors: errors.count ?? 0,
      upcomingExpirations: upcoming.count ?? 0,
      expirationWindowDays: EXPIRATION_WINDOW_DAYS,
    });
  } catch (error) {
    return jsonError(getErrorMessage(error));
  }
}
