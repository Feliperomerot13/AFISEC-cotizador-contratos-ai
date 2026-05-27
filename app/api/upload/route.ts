import { STORAGE_BUCKET } from "@/lib/constants";
import { NON_TERMINAL_AMENDMENT_STATES } from "@/lib/amendments";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { uploadFormSchema } from "@/lib/schemas";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let createdContractId: string | number | null = null;

  try {
    const formData = await request.formData();
    const input = uploadFormSchema.parse({
      nombreCliente: formData.get("nombreCliente"),
      nitCliente: formData.get("nitCliente"),
      ejecutivo: formData.get("ejecutivo"),
      tipoDocumento: formData.get("tipoDocumento"),
      contratoBaseId: valueOrUndefined(formData.get("contratoBaseId")),
    });
    const pdf = formData.get("pdf");

    if (!(pdf instanceof File)) {
      return jsonError("Debes cargar un archivo PDF.", 400);
    }

    if (
      pdf.type !== "application/pdf" &&
      !pdf.name.toLowerCase().endsWith(".pdf")
    ) {
      return jsonError("El archivo debe ser un PDF.", 400);
    }

    const supabase = getSupabaseAdmin();

    if (input.tipoDocumento === "otrosi") {
      if (!input.contratoBaseId) {
        return jsonError("Debes seleccionar el contrato base del otrosí.", 400);
      }

      const { data: baseContract, error: baseContractError } = await supabase
        .from("contratos")
        .select("id,cliente_id,clientes!inner(id,nombre,nit,ejecutivo)")
        .eq("id", input.contratoBaseId)
        .single();

      if (baseContractError || !baseContract) {
        throw new Error(
          `No se encontró el contrato base: ${baseContractError?.message ?? "sin detalle"}`,
        );
      }

      const { data: activeIssuedQuote, error: activeIssuedQuoteError } =
        await supabase
          .from("cotizaciones")
          .select("id")
          .eq("contrato_id", input.contratoBaseId)
          .eq("estado", "emitida")
          .maybeSingle();

      if (activeIssuedQuoteError) {
        throw new Error(
          `Fallo al validar póliza emitida: ${activeIssuedQuoteError.message}`,
        );
      }

      if (!activeIssuedQuote) {
        return jsonError(
          "Solo se puede cargar un otrosí cuando exista una póliza base emitida.",
          409,
        );
      }

      const { data: pendingModifications, error: pendingError } = await supabase
        .from("modificaciones_contractuales")
        .select("id,numero_modificacion,estado")
        .eq("contrato_id", input.contratoBaseId)
        .in("estado", [...NON_TERMINAL_AMENDMENT_STATES])
        .limit(1);

      if (pendingError) {
        throw new Error(
          `Fallo al validar secuencia de otrosíes: ${pendingError.message}`,
        );
      }

      const pendingModification = pendingModifications?.[0] ?? null;

      if (pendingModification) {
        return jsonError(
          `Ya existe un otrosí pendiente (${pendingModification.numero_modificacion ?? pendingModification.id}). Debe emitirse o eliminarse antes de cargar otro.`,
          409,
        );
      }

      const { data: latestModifications, error: latestModificationError } =
        await supabase
          .from("modificaciones_contractuales")
          .select("secuencia")
          .eq("contrato_id", input.contratoBaseId)
          .order("secuencia", { ascending: false, nullsFirst: false })
          .limit(1);

      if (latestModificationError) {
        throw new Error(
          `Fallo al consultar secuencia de otrosíes: ${latestModificationError.message}`,
        );
      }

      const nextSequence = (latestModifications?.[0]?.secuencia ?? 0) + 1;
      const baseContractRecord = baseContract as unknown as {
        id: string | number;
        clientes:
          | { id: string | number; nombre: string; nit: string | null; ejecutivo: string }
          | Array<{ id: string | number; nombre: string; nit: string | null; ejecutivo: string }>;
      };
      const cliente = Array.isArray(baseContractRecord.clientes)
        ? baseContractRecord.clientes[0]
        : baseContractRecord.clientes;
      const storagePath = [
        cliente.id,
        baseContractRecord.id,
        "otrosies",
        `${Date.now()}-${safeFileName(pdf.name)}`,
      ].join("/");
      const bytes = Buffer.from(await pdf.arrayBuffer());
      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, bytes, {
          contentType: pdf.type || "application/pdf",
          upsert: false,
        });

      if (uploadError) {
        throw new Error(
          `Fallo al subir el PDF a Supabase Storage: ${uploadError.message}`,
        );
      }

      const { data: document, error: documentError } = await supabase
        .from("documentos")
        .insert({
          contrato_id: baseContractRecord.id,
          nombre_archivo: pdf.name,
          storage_bucket: STORAGE_BUCKET,
          storage_path: storagePath,
          mime_type: pdf.type || "application/pdf",
          size_bytes: pdf.size,
          tipo_documento: "otrosi",
        })
        .select("id")
        .single();

      if (documentError || !document) {
        throw new Error(
          `Fallo al registrar el documento: ${documentError?.message ?? "sin detalle"}`,
        );
      }

      const { data: modification, error: modificationError } = await supabase
        .from("modificaciones_contractuales")
        .insert({
          contrato_id: baseContractRecord.id,
          documento_id: document.id,
          secuencia: nextSequence,
          cotizacion_base_id: activeIssuedQuote.id,
          estado: "cargado",
          requiere_revision: true,
          requiere_ajuste_garantias: true,
        })
        .select("id")
        .single();

      if (modificationError || !modification) {
        throw new Error(
          `Fallo al crear el registro del otrosí: ${modificationError?.message ?? "sin detalle"}`,
        );
      }

      return jsonOk({
        contractId: baseContractRecord.id,
        documentId: document.id,
        modificationId: modification.id,
        status: "cargado",
      });
    }

    const cliente = await createOrReuseClient({
      nombre: input.nombreCliente,
      nit: input.nitCliente,
      ejecutivo: input.ejecutivo,
    });

    const { data: contract, error: contractError } = await supabase
      .from("contratos")
      .insert({
        cliente_id: cliente.id,
        estado: "cargado",
      })
      .select("id")
      .single();

    if (contractError || !contract) {
      throw new Error(
        `Fallo al crear el contrato: ${contractError?.message ?? "sin detalle"}`,
      );
    }

    createdContractId = contract.id;

    const storagePath = [
      cliente.id,
      contract.id,
      `${Date.now()}-${safeFileName(pdf.name)}`,
    ].join("/");
    const bytes = Buffer.from(await pdf.arrayBuffer());
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, bytes, {
        contentType: pdf.type || "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      throw new Error(
        `Fallo al subir el PDF a Supabase Storage: ${uploadError.message}`,
      );
    }

    const { data: document, error: documentError } = await supabase
      .from("documentos")
      .insert({
        contrato_id: contract.id,
        nombre_archivo: pdf.name,
        storage_bucket: STORAGE_BUCKET,
        storage_path: storagePath,
        mime_type: pdf.type || "application/pdf",
        size_bytes: pdf.size,
        tipo_documento: input.tipoDocumento,
      })
      .select("id")
      .single();

    if (documentError || !document) {
      throw new Error(
        `Fallo al registrar el documento: ${documentError?.message ?? "sin detalle"}`,
      );
    }

    return jsonOk({
      contractId: contract.id,
      documentId: document.id,
      status: "cargado",
    });
  } catch (error) {
    const message = getErrorMessage(error);

    if (createdContractId) {
      await getSupabaseAdmin()
        .from("contratos")
        .update({
          estado: "error",
          mensaje_error: message,
        })
        .eq("id", createdContractId);
    }

    return jsonError(message, 400);
  }
}

async function createOrReuseClient({
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

function safeFileName(fileName: string) {
  const normalized = fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return normalized || "contrato.pdf";
}

function valueOrUndefined(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
