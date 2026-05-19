import { STORAGE_BUCKET } from "@/lib/constants";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import type { Amparo, Cliente, Contrato } from "@/lib/database.types";
import { generateQuotePdf } from "@/lib/quote-pdf";
import {
  buildQuoteNumber,
  buildQuoteSnapshot,
  getQuoteCommercialIssues,
  snapshotToJson,
} from "@/lib/quotes";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type IdContext = {
  params: Promise<{ id: string }>;
};

type ContractWithClient = Contrato & {
  clientes:
    | Cliente
    | Cliente[];
};

export async function POST(_request: Request, { params }: IdContext) {
  try {
    const { id } = await params;
    const supabase = getSupabaseAdmin();

    const { data: activeIssuedQuote, error: activeIssuedQuoteError } =
      await supabase
        .from("cotizaciones")
        .select("id")
        .eq("contrato_id", id)
        .eq("estado", "emitida")
        .maybeSingle();

    if (activeIssuedQuoteError) {
      throw new Error(
        `Fallo al validar emisión activa: ${activeIssuedQuoteError.message}`,
      );
    }

    if (activeIssuedQuote) {
      return jsonError(
        "La póliza base ya está emitida. Revierte o anula la emisión antes de generar una nueva cotización.",
        409,
      );
    }

    const { data: contractData, error: contractError } = await supabase
      .from("contratos")
      .select("*,clientes!inner(*)")
      .eq("id", id)
      .single();

    if (contractError || !contractData) {
      return jsonError(
        `No se encontró el contrato: ${contractError?.message ?? "sin detalle"}`,
        404,
      );
    }

    const contractRecord = contractData as unknown as ContractWithClient;
    const { clientes, ...contractFields } = contractRecord;
    const client = Array.isArray(clientes) ? clientes[0] : clientes;
    const contract = contractFields as Contrato;

    if (contract.estado !== "validado") {
      return jsonError(
        "Debes validar la revisión antes de generar una cotización.",
        400,
      );
    }

    const { data: amparos, error: amparosError } = await supabase
      .from("amparos")
      .select("*")
      .eq("contrato_id", id)
      .order("creado_en", { ascending: true });

    if (amparosError) {
      throw new Error(`Fallo al consultar amparos: ${amparosError.message}`);
    }

    const { data: latestQuotes, error: latestQuoteError } = await supabase
      .from("cotizaciones")
      .select("numero_cotizacion,version")
      .eq("contrato_id", id)
      .order("version", { ascending: false })
      .limit(1);

    if (latestQuoteError) {
      throw new Error(
        `Fallo al consultar versiones previas: ${latestQuoteError.message}`,
      );
    }

    const generatedAt = new Date().toISOString();
    const latestQuote = latestQuotes?.[0] ?? null;
    const quoteNumber =
      latestQuote?.numero_cotizacion ?? buildQuoteNumber(id, generatedAt);
    const version = (latestQuote?.version ?? 0) + 1;
    const snapshot = buildQuoteSnapshot({
      contract,
      client,
      amparos: (amparos ?? []) as Amparo[],
      generatedAt,
    });
    const commercialIssues = getQuoteCommercialIssues(snapshot);

    if (commercialIssues.length > 0) {
      return jsonError(
        [
          "No se puede generar el PDF de cotización porque hay amparos con datos comerciales incompletos.",
          ...commercialIssues,
          "Completa los datos o excluye el amparo antes de generar la cotización.",
        ].join(" "),
        422,
      );
    }

    const pdf = generateQuotePdf({
      quoteNumber,
      version,
      snapshot,
    });
    const pdfFileName = `${quoteNumber}-v${version}.pdf`;
    const pdfPath = [
      client.id,
      id,
      "cotizaciones",
      safeStorageFileName(pdfFileName),
    ].join("/");

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(pdfPath, pdf, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`Fallo al guardar el PDF: ${uploadError.message}`);
    }

    const { data: quote, error: quoteError } = await supabase
      .from("cotizaciones")
      .insert({
        contrato_id: id,
        numero_cotizacion: quoteNumber,
        version,
        estado: "generada",
        snapshot: snapshotToJson(snapshot),
        total_prima_neta: snapshot.totales.prima_neta,
        total_iva: snapshot.totales.iva,
        total_prima: snapshot.totales.prima_total,
        pdf_bucket: STORAGE_BUCKET,
        pdf_path: pdfPath,
        pdf_nombre_archivo: pdfFileName,
        fecha_generacion: generatedAt,
      })
      .select("*")
      .single();

    if (quoteError || !quote) {
      throw new Error(
        `Fallo al guardar la cotización: ${quoteError?.message ?? "sin detalle"}`,
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
