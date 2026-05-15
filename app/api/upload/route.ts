import { STORAGE_BUCKET } from "@/lib/constants";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { uploadFormSchema } from "@/lib/schemas";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let createdContractId: string | null = null;

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

      const baseContractRecord = baseContract as unknown as {
        id: string;
        clientes:
          | { id: string; nombre: string; nit: string; ejecutivo: string }
          | Array<{ id: string; nombre: string; nit: string; ejecutivo: string }>;
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

      return jsonOk({
        contractId: baseContractRecord.id,
        documentId: document.id,
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
