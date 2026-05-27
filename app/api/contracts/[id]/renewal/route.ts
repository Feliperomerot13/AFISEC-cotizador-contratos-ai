import { z } from "zod";
import { STORAGE_BUCKET } from "@/lib/constants";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import type { Cotizacion } from "@/lib/database.types";
import { addDaysToDateOnly, diffDaysDateOnly } from "@/lib/date-only";
import { generateQuotePdf } from "@/lib/quote-pdf";
import {
  calculateQuoteTotals,
  getQuoteCommercialIssues,
  getQuoteSnapshot,
  snapshotToJson,
  type QuoteSnapshot,
  type QuoteSnapshotCoverage,
} from "@/lib/quotes";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type IdContext = {
  params: Promise<{ id: string }>;
};

const renewalSchema = z.object({
  fecha_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fecha_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(request: Request, { params }: IdContext) {
  try {
    const { id } = await params;
    const payload = renewalSchema.parse(await request.json());
    const days = diffDaysDateOnly(payload.fecha_inicio, payload.fecha_fin);

    if (days === null || days <= 0) {
      return jsonError(
        "Las fechas de prórroga deben estar completas y la fecha fin debe ser posterior a la fecha inicio.",
        422,
      );
    }

    const supabase = getSupabaseAdmin();
    const { data: contract, error: contractError } = await supabase
      .from("contratos")
      .select("id,renovable_automaticamente")
      .eq("id", id)
      .single();

    if (contractError || !contract) {
      return jsonError(
        `No se encontró el contrato: ${contractError?.message ?? "sin detalle"}`,
        404,
      );
    }

    if (!contract.renovable_automaticamente) {
      return jsonError(
        "Solo los contratos marcados como renovables pueden prorrogarse desde esta acción.",
        409,
      );
    }

    const { data: activeQuote, error: activeQuoteError } = await supabase
      .from("cotizaciones")
      .select("*")
      .eq("contrato_id", id)
      .eq("estado", "emitida")
      .maybeSingle();

    if (activeQuoteError) {
      throw new Error(
        `Fallo al consultar póliza emitida: ${activeQuoteError.message}`,
      );
    }

    if (!activeQuote) {
      return jsonError(
        "Debe existir una póliza base emitida para generar una prórroga.",
        409,
      );
    }

    const baseSnapshot = getQuoteSnapshot(activeQuote as Cotizacion);

    if (!baseSnapshot) {
      return jsonError(
        "La póliza emitida no tiene snapshot suficiente para generar prórroga.",
        422,
      );
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
      latestQuote?.numero_cotizacion ?? activeQuote.numero_cotizacion;
    const version = (latestQuote?.version ?? activeQuote.version ?? 0) + 1;
    const snapshot = buildRenewalSnapshot({
      baseSnapshot,
      generatedAt,
      fechaInicio: payload.fecha_inicio,
      fechaFin: payload.fecha_fin,
    });
    const commercialIssues = getQuoteCommercialIssues(snapshot);

    if (commercialIssues.length > 0) {
      return jsonError(
        [
          "No se puede generar la cotización de prórroga porque hay amparos con datos comerciales incompletos.",
          ...commercialIssues,
        ].join(" "),
        422,
      );
    }

    const pdf = generateQuotePdf({ quoteNumber, version, snapshot });
    const pdfFileName = `${quoteNumber}-v${version}-prorroga.pdf`;
    const pdfPath = [
      baseSnapshot.cliente.id,
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
        `Fallo al guardar la cotización de prórroga: ${quoteError?.message ?? "sin detalle"}`,
      );
    }

    return jsonOk({ quote });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}

function buildRenewalSnapshot({
  baseSnapshot,
  generatedAt,
  fechaInicio,
  fechaFin,
}: {
  baseSnapshot: QuoteSnapshot;
  generatedAt: string;
  fechaInicio: string;
  fechaFin: string;
}) {
  const amparos = baseSnapshot.amparos.map((coverage) =>
    recalculateRenewalCoverage({
      coverage,
      previousContractEnd: baseSnapshot.contrato.fecha_fin,
      renewalStart: fechaInicio,
      renewalEnd: fechaFin,
    }),
  );

  return {
    ...baseSnapshot,
    generado_en: generatedAt,
    contrato: {
      ...baseSnapshot.contrato,
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
    },
    amparos,
    totales: calculateQuoteTotals(amparos),
    observaciones: [
      "Cotización de prórroga generada sobre póliza emitida renovable.",
      ...baseSnapshot.observaciones,
    ],
  } satisfies QuoteSnapshot;
}

function recalculateRenewalCoverage({
  coverage,
  previousContractEnd,
  renewalStart,
  renewalEnd,
}: {
  coverage: QuoteSnapshotCoverage;
  previousContractEnd: string | null;
  renewalStart: string;
  renewalEnd: string;
}): QuoteSnapshotCoverage {
  const additionalDays =
    previousContractEnd && coverage.fecha_hasta
      ? Math.max(0, diffDaysDateOnly(previousContractEnd, coverage.fecha_hasta) ?? 0)
      : 0;
  const fechaHasta = addDaysToDateOnly(renewalEnd, additionalDays) ?? renewalEnd;
  const diasVigencia = diffDaysDateOnly(renewalStart, fechaHasta);
  const premium = calculatePremium({
    insuredValue: coverage.valor_asegurado,
    rate: coverage.tasa,
    validityDays: diasVigencia,
    ivaPercentage: inferIvaPercentage(coverage),
  });

  return {
    ...coverage,
    fecha_desde: renewalStart,
    fecha_hasta: fechaHasta,
    dias_vigencia: diasVigencia,
    prima_neta: premium.prima_neta,
    iva: premium.iva,
    prima_total: premium.prima_total,
  };
}

function calculatePremium({
  insuredValue,
  rate,
  validityDays,
  ivaPercentage,
}: {
  insuredValue: number | null;
  rate: number | null;
  validityDays: number | null;
  ivaPercentage: number;
}) {
  if (insuredValue === null || rate === null || validityDays === null) {
    return {
      prima_neta: null,
      iva: null,
      prima_total: null,
    };
  }

  const primaNeta = roundMoney((insuredValue * rate * validityDays) / 365);
  const iva = roundMoney(primaNeta * ivaPercentage);

  return {
    prima_neta: primaNeta,
    iva,
    prima_total: roundMoney(primaNeta + iva),
  };
}

function inferIvaPercentage(coverage: QuoteSnapshotCoverage) {
  if (
    coverage.prima_neta !== null &&
    coverage.prima_neta > 0 &&
    coverage.iva !== null
  ) {
    return coverage.iva / coverage.prima_neta;
  }

  return 0.19;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function safeStorageFileName(fileName: string) {
  return fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
