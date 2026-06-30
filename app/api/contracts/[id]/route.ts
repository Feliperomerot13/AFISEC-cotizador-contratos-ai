import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { normalizeText } from "@/lib/format";
import { deleteContractSchema } from "@/lib/schemas";
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

export async function DELETE(request: Request, { params }: IdContext) {
  try {
    const { id } = await params;
    deleteContractSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc(
      "eliminar_contrato_no_emitido",
      {
        p_contrato_id: id,
      },
    );

    if (error) {
      const status = /emitid|trazabilidad|estado vigente/i.test(error.message)
        ? 409
        : 400;

      return jsonError(error.message, status);
    }

    const storageObjects = parseStorageObjects(data);
    const storageWarnings: string[] = [];
    const pathsByBucket = new Map<string, string[]>();

    storageObjects.forEach(({ bucket, path }) => {
      pathsByBucket.set(bucket, [...(pathsByBucket.get(bucket) ?? []), path]);
    });

    for (const [bucket, paths] of pathsByBucket) {
      const { error: storageError } = await supabase.storage
        .from(bucket)
        .remove(paths);

      if (storageError) {
        storageWarnings.push(
          `No se pudieron limpiar ${paths.length} archivo(s) del bucket ${bucket}: ${storageError.message}`,
        );
      }
    }

    return jsonOk({
      deleted: true,
      contractId: id,
      storageWarnings,
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}

function parseStorageObjects(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const storageObjects = (value as Record<string, unknown>).storage_objects;

  if (!Array.isArray(storageObjects)) {
    return [];
  }

  return storageObjects.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }

    const record = item as Record<string, unknown>;

    return typeof record.bucket === "string" &&
      typeof record.path === "string" &&
      record.bucket &&
      record.path
      ? [{ bucket: record.bucket, path: record.path }]
      : [];
  });
}
