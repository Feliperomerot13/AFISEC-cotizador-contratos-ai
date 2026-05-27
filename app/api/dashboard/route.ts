import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    const [
      total,
      pending,
      baseQuotes,
      issuedBasePolicies,
      amendmentsInReview,
      issuedAmendments,
    ] = await Promise.all([
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
      supabase
        .from("modificaciones_contractuales")
        .select("id", { count: "exact", head: true })
        .in("estado", [
          "cargado",
          "procesando",
          "pendiente_revision",
          "validado",
          "cotizado",
          "error",
          "pendiente_aplicacion",
        ]),
      supabase
        .from("modificaciones_contractuales")
        .select("id", { count: "exact", head: true })
        .eq("estado", "endoso_emitido"),
    ]);

    const firstError =
      total.error ??
      pending.error ??
      baseQuotes.error ??
      issuedBasePolicies.error ??
      amendmentsInReview.error ??
      issuedAmendments.error;

    if (firstError) {
      throw new Error(`Fallo al consultar indicadores: ${firstError.message}`);
    }

    return jsonOk({
      total: total.count ?? 0,
      pendingValidation: pending.count ?? 0,
      baseQuotesGenerated: baseQuotes.count ?? 0,
      basePoliciesIssued: issuedBasePolicies.count ?? 0,
      amendmentsInReview: amendmentsInReview.count ?? 0,
      issuedAmendments: issuedAmendments.count ?? 0,
    });
  } catch (error) {
    return jsonError(getErrorMessage(error));
  }
}
