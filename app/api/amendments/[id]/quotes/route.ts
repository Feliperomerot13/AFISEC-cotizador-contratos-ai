import { STORAGE_BUCKET } from "@/lib/constants";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { generateAmendmentQuotePdf } from "@/lib/amendment-pdf";
import {
  amendmentSnapshotToJson,
  buildAmendmentQuoteNumber,
  buildAmendmentQuoteSnapshot,
  calculateAmendmentLiquidation,
  getAmendmentCommercialIssues,
  getBasePolicyEndorsementIssues,
  isTerminalAmendmentState,
  liquidationToJson,
} from "@/lib/amendments";
import { loadAmendmentContext } from "@/lib/amendment-context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type IdContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, { params }: IdContext) {
  try {
    const { id } = await params;
    const context = await loadAmendmentContext(id);

    if (context.modification.estado === "endoso_emitido") {
      return jsonError("Este otrosí ya fue emitido.", 409);
    }

    if (isTerminalAmendmentState(context.modification.estado)) {
      return jsonError("Este otrosí está cerrado y no puede cotizarse.", 409);
    }

    if (!["validado", "cotizado"].includes(context.modification.estado)) {
      return jsonError(
        "Revisa y valida el delta del otrosí antes de generar la cotización de ajuste.",
        409,
      );
    }

    const basePolicyIssues = getBasePolicyEndorsementIssues({
      activeState: context.activeState,
      baseQuote: context.baseQuote,
      contract: context.contract,
    });

    if (basePolicyIssues.length > 0) {
      return jsonError(
        [
          "No se puede generar la cotización de ajuste porque la póliza base emitida está incompleta.",
          ...basePolicyIssues,
        ].join(" "),
        422,
      );
    }

    const supabase = getSupabaseAdmin();
    const { data: latestQuotes, error: latestQuoteError } = await supabase
      .from("cotizaciones_ajuste")
      .select("numero_cotizacion,version")
      .eq("modificacion_id", id)
      .order("version", { ascending: false })
      .limit(1);

    if (latestQuoteError) {
      throw new Error(
        `Fallo al consultar versiones de ajuste: ${latestQuoteError.message}`,
      );
    }

    const generatedAt = new Date().toISOString();
    const latestQuote = latestQuotes?.[0] ?? null;
    const sequence = context.modification.secuencia ?? 1;
    const quoteNumber =
      latestQuote?.numero_cotizacion ??
      buildAmendmentQuoteNumber({
        contractId: context.contract.id,
        sequence,
        generatedAt,
      });
    const version = (latestQuote?.version ?? 0) + 1;
    const liquidation = calculateAmendmentLiquidation({
      activeState: context.activeState,
      modification: context.modification,
      generatedAt,
    });
    const issues = getAmendmentCommercialIssues(liquidation);

    if (issues.length > 0) {
      return jsonError(
        [
          "No se puede generar el PDF de ajuste porque hay datos comerciales incompletos.",
          ...issues,
          "Corrige la revisión del otrosí antes de generar la cotización.",
        ].join(" "),
        422,
      );
    }

    const snapshot = buildAmendmentQuoteSnapshot({
      quoteNumber,
      version,
      generatedAt,
      client: context.client,
      contract: context.contract,
      baseQuote: context.baseQuote,
      modification: context.modification,
      activeState: context.activeState,
      liquidation,
    });
    const pdf = generateAmendmentQuotePdf(snapshot);
    const pdfFileName = `${quoteNumber}-v${version}.pdf`;
    const pdfPath = [
      context.client.id,
      context.contract.id,
      "otrosies",
      id,
      "cotizaciones-ajuste",
      safeStorageFileName(pdfFileName),
    ].join("/");

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(pdfPath, pdf, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`Fallo al guardar el PDF de ajuste: ${uploadError.message}`);
    }

    const { data: quote, error: quoteError } = await supabase
      .from("cotizaciones_ajuste")
      .insert({
        contrato_id: context.contract.id,
        modificacion_id: context.modification.id,
        numero_cotizacion: quoteNumber,
        version,
        estado: "generada",
        snapshot: amendmentSnapshotToJson(snapshot),
        total_prima_neta: snapshot.liquidacion.totales.prima_neta,
        total_iva: snapshot.liquidacion.totales.iva,
        total_prima: snapshot.liquidacion.totales.prima_total,
        pdf_bucket: STORAGE_BUCKET,
        pdf_path: pdfPath,
        pdf_nombre_archivo: pdfFileName,
        fecha_generacion: generatedAt,
      })
      .select("*")
      .single();

    if (quoteError || !quote) {
      throw new Error(
        `Fallo al guardar cotización de ajuste: ${quoteError?.message ?? "sin detalle"}`,
      );
    }

    const { error: updateError } = await supabase
      .from("modificaciones_contractuales")
      .update({
        estado: "cotizado",
        liquidacion: liquidationToJson(liquidation),
        actualizado_en: generatedAt,
      })
      .eq("id", id);

    if (updateError) {
      throw new Error(
        `Fallo al actualizar estado del otrosí: ${updateError.message}`,
      );
    }

    return jsonOk({ quote });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}

function safeStorageFileName(fileName: string) {
  return fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
