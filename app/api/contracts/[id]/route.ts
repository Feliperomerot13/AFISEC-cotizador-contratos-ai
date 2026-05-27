import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { normalizeText } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type IdContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: IdContext) {
  try {
    const { id } = await params;
    const supabase = getSupabaseAdmin();

    const { data: contract, error: contractError } = await supabase
      .from("contratos")
      .select("*,clientes!inner(*)")
      .eq("id", id)
      .single();

    if (contractError || !contract) {
      return jsonError(
        `No se encontró el contrato: ${contractError?.message ?? "sin detalle"}`,
        404,
      );
    }

    const [
      { data: documents, error: documentsError },
      { data: amparos, error: amparosError },
      { data: latestExtraction, error: latestExtractionError },
      { data: cotizaciones, error: cotizacionesError },
      { data: modificaciones, error: modificacionesError },
      { data: cotizacionesAjuste, error: cotizacionesAjusteError },
    ] = await Promise.all([
      supabase
        .from("documentos")
        .select(
          "id,nombre_archivo,storage_bucket,mime_type,size_bytes,tipo_documento,fecha_carga,actualizado_en",
        )
        .eq("contrato_id", id)
        .order("fecha_carga", { ascending: false }),
      supabase
        .from("amparos")
        .select("*")
        .eq("contrato_id", id)
        .order("creado_en", { ascending: true }),
      supabase
        .from("extracciones")
        .select("json_original")
        .eq("contrato_id", id)
        .in("resultado", ["exito", "parcial"])
        .order("fecha_extraccion", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("cotizaciones")
        .select("*")
        .eq("contrato_id", id)
        .order("version", { ascending: false }),
      supabase
        .from("modificaciones_contractuales")
        .select("*")
        .eq("contrato_id", id)
        .order("secuencia", { ascending: true, nullsFirst: false })
        .order("creado_en", { ascending: true }),
      supabase
        .from("cotizaciones_ajuste")
        .select("*")
        .eq("contrato_id", id)
        .order("fecha_generacion", { ascending: false }),
    ]);

    if (documentsError) {
      throw new Error(`Fallo al consultar documentos: ${documentsError.message}`);
    }

    if (amparosError) {
      throw new Error(`Fallo al consultar amparos: ${amparosError.message}`);
    }

    if (latestExtractionError) {
      throw new Error(
        `Fallo al consultar la extracción: ${latestExtractionError.message}`,
      );
    }

    if (cotizacionesError) {
      throw new Error(
        `Fallo al consultar cotizaciones: ${cotizacionesError.message}`,
      );
    }

    if (modificacionesError) {
      throw new Error(
        `Fallo al consultar otrosíes: ${modificacionesError.message}`,
      );
    }

    if (cotizacionesAjusteError) {
      throw new Error(
        `Fallo al consultar cotizaciones de ajuste: ${cotizacionesAjusteError.message}`,
      );
    }

    const tipos = Array.from(
      new Set((amparos ?? []).map((amparo) => amparo.tipo_amparo)),
    );
    const { data: tasas, error: tasasError } = await supabase
      .from("tasas_referencia")
      .select("*")
      .eq("vigente", true);

    if (tasasError) {
      throw new Error(
        `Fallo al consultar tasas de referencia: ${tasasError.message}`,
      );
    }

    const relevantRates = (tasas ?? []).filter((tasa) => {
      if (tipos.length === 0) {
        return true;
      }

      return tipos.some(
        (tipo) => normalizeText(tipo) === normalizeText(tasa.tipo_amparo),
      );
    });

    const { clientes, ...contractFields } = contract as unknown as Record<
      string,
      unknown
    >;

    return jsonOk({
      contract: contractFields,
      client: clientes,
      documents: documents ?? [],
      amparos: amparos ?? [],
      tasasReferencia: relevantRates,
      extraction: latestExtraction?.json_original ?? null,
      cotizaciones: cotizaciones ?? [],
      modificaciones: modificaciones ?? [],
      cotizacionesAjuste: cotizacionesAjuste ?? [],
    });
  } catch (error) {
    return jsonError(getErrorMessage(error));
  }
}
