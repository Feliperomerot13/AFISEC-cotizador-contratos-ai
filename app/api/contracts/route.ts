import { EXPIRATION_WINDOW_DAYS } from "@/lib/constants";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { contractListQuerySchema } from "@/lib/schemas";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { normalizeText } from "@/lib/format";

export const runtime = "nodejs";

type ContractListRecord = {
  id: string;
  numero_contrato: string | null;
  objeto: string | null;
  tipo_contrato: string | null;
  valor_contrato: number | null;
  moneda: string;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  contratista: string | null;
  contratista_nit: string | null;
  estado: string;
  mensaje_error: string | null;
  fecha_procesamiento: string | null;
  fecha_validacion: string | null;
  creado_en: string;
  clientes: {
    id: string;
    nombre: string;
    nit: string;
    ejecutivo: string;
  };
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filters = contractListQuerySchema.parse({
      ejecutivo: valueOrUndefined(url.searchParams.get("ejecutivo")),
      estado: valueOrUndefined(url.searchParams.get("estado")),
      search: valueOrUndefined(url.searchParams.get("search")),
      vencen: valueOrUndefined(url.searchParams.get("vencen")),
    });

    const supabase = getSupabaseAdmin();
    let query = supabase
      .from("contratos")
      .select(
        [
          "id",
          "numero_contrato",
          "objeto",
          "tipo_contrato",
          "valor_contrato",
          "moneda",
          "fecha_inicio",
          "fecha_fin",
          "contratista",
          "contratista_nit",
          "estado",
          "mensaje_error",
          "fecha_procesamiento",
          "fecha_validacion",
          "creado_en",
          "clientes!inner(id,nombre,nit,ejecutivo)",
        ].join(","),
      )
      .order("creado_en", { ascending: false })
      .limit(150);

    if (filters.ejecutivo) {
      query = query.eq("clientes.ejecutivo", filters.ejecutivo);
    }

    if (filters.estado) {
      query = query.eq("estado", filters.estado);
    }

    if (filters.vencen === "30") {
      const today = new Date();
      const expirationLimit = new Date(today);
      expirationLimit.setDate(today.getDate() + EXPIRATION_WINDOW_DAYS);

      query = query
        .gte("fecha_fin", today.toISOString().slice(0, 10))
        .lte("fecha_fin", expirationLimit.toISOString().slice(0, 10));
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Fallo al consultar contratos: ${error.message}`);
    }

    const search = normalizeText(filters.search);
    const records = ((data ?? []) as unknown as ContractListRecord[]).filter(
      (record) => {
        if (!search) {
          return true;
        }

        return [
          record.numero_contrato,
          record.contratista,
          record.contratista_nit,
          record.clientes.nombre,
          record.clientes.nit,
        ].some((value) => normalizeText(value).includes(search));
      },
    );

    return jsonOk({ contracts: records });
  } catch (error) {
    return jsonError(getErrorMessage(error));
  }
}

function valueOrUndefined(value: string | null) {
  return value && value !== "todos" ? value : undefined;
}
