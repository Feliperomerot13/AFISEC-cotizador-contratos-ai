import {
  getActiveStateFromEndorsements,
  type AmendmentActiveState,
} from "@/lib/amendments";
import type {
  Amparo,
  Cliente,
  Contrato,
  Cotizacion,
  CotizacionAjuste,
  ModificacionContractual,
} from "@/lib/database.types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type ContractWithClient = Contrato & {
  clientes: Cliente | Cliente[];
};

export type AmendmentContext = {
  contract: Contrato;
  client: Cliente;
  baseQuote: Cotizacion;
  modification: ModificacionContractual;
  amparos: Amparo[];
  adjustmentQuotes: CotizacionAjuste[];
  activeState: AmendmentActiveState;
};

export async function loadAmendmentContext(
  amendmentId: string | number,
): Promise<AmendmentContext> {
  const supabase = getSupabaseAdmin();
  const { data: modification, error: modificationError } = await supabase
    .from("modificaciones_contractuales")
    .select("*")
    .eq("id", amendmentId)
    .single();

  if (modificationError || !modification) {
    throw new Error(
      `No se encontró el otrosí: ${modificationError?.message ?? "sin detalle"}`,
    );
  }

  const [
    { data: contractData, error: contractError },
    { data: baseQuote, error: baseQuoteError },
    { data: amparos, error: amparosError },
    { data: adjustmentQuotes, error: adjustmentQuotesError },
  ] = await Promise.all([
    supabase
      .from("contratos")
      .select("*,clientes!inner(*)")
      .eq("id", modification.contrato_id)
      .single(),
    supabase
      .from("cotizaciones")
      .select("*")
      .eq("contrato_id", modification.contrato_id)
      .eq("estado", "emitida")
      .maybeSingle(),
    supabase
      .from("amparos")
      .select("*")
      .eq("contrato_id", modification.contrato_id)
      .is("modificacion_id", null)
      .order("creado_en", { ascending: true }),
    supabase
      .from("cotizaciones_ajuste")
      .select("*")
      .eq("contrato_id", modification.contrato_id)
      .eq("estado", "endoso_emitido")
      .order("fecha_emision", { ascending: true }),
  ]);

  if (contractError || !contractData) {
    throw new Error(
      `No se encontró el contrato base: ${contractError?.message ?? "sin detalle"}`,
    );
  }

  if (baseQuoteError) {
    throw new Error(
      `Fallo al consultar póliza base emitida: ${baseQuoteError.message}`,
    );
  }

  if (!baseQuote) {
    throw new Error(
      "Solo se puede trabajar un otrosí cuando existe una póliza base emitida.",
    );
  }

  if (amparosError) {
    throw new Error(`Fallo al consultar amparos base: ${amparosError.message}`);
  }

  if (adjustmentQuotesError) {
    throw new Error(
      `Fallo al consultar otrosíes emitidos: ${adjustmentQuotesError.message}`,
    );
  }

  const record = contractData as unknown as ContractWithClient;
  const { clientes, ...contractFields } = record;
  const client = Array.isArray(clientes) ? clientes[0] : clientes;
  const activeState = getActiveStateFromEndorsements({
    baseQuote,
    amparos: amparos ?? [],
    adjustmentQuotes: adjustmentQuotes ?? [],
    beforeSequence: modification.secuencia,
  });

  return {
    contract: contractFields as Contrato,
    client,
    baseQuote,
    modification,
    amparos: amparos ?? [],
    adjustmentQuotes: adjustmentQuotes ?? [],
    activeState,
  };
}
