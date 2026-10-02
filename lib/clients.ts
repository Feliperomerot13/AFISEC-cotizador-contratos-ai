import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function createOrReuseClient({
  nombre,
  nit,
  ejecutivo,
}: {
  nombre: string;
  nit: string;
  ejecutivo: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data: existing, error: findError } = await supabase
    .from("clientes")
    .select("*")
    .eq("nit", nit)
    .maybeSingle();

  if (findError) {
    throw new Error(`Fallo al buscar el cliente: ${findError.message}`);
  }

  if (existing) {
    const { data: updated, error: updateError } = await supabase
      .from("clientes")
      .update({
        nombre,
        ejecutivo,
      })
      .eq("id", existing.id)
      .select("*")
      .single();

    if (updateError || !updated) {
      throw new Error(
        `Fallo al actualizar el cliente: ${updateError?.message ?? "sin detalle"}`,
      );
    }

    return updated;
  }

  const { data: created, error: createError } = await supabase
    .from("clientes")
    .insert({
      nombre,
      nit,
      ejecutivo,
    })
    .select("*")
    .single();

  if (createError || !created) {
    throw new Error(
      `Fallo al crear el cliente: ${createError?.message ?? "sin detalle"}`,
    );
  }

  return created;
}
