import { getErrorMessage, jsonError } from "@/lib/api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type IdContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: IdContext) {
  try {
    const { id } = await params;
    const supabase = getSupabaseAdmin();
    const { data: quote, error: quoteError } = await supabase
      .from("cotizaciones")
      .select("pdf_bucket,pdf_path,pdf_nombre_archivo")
      .eq("id", id)
      .single();

    if (quoteError || !quote) {
      return jsonError(
        `No se encontró la cotización: ${quoteError?.message ?? "sin detalle"}`,
        404,
      );
    }

    if (!quote.pdf_bucket || !quote.pdf_path) {
      return jsonError("La cotización no tiene PDF asociado.", 404);
    }

    const { data: file, error: downloadError } = await supabase.storage
      .from(quote.pdf_bucket)
      .download(quote.pdf_path);

    if (downloadError || !file) {
      throw new Error(
        `Fallo al descargar el PDF: ${downloadError?.message ?? "sin detalle"}`,
      );
    }

    const fileName = sanitizeHeaderFileName(
      quote.pdf_nombre_archivo ?? "cotizacion-afisec.pdf",
    );

    return new Response(await file.arrayBuffer(), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Type": "application/pdf",
      },
    });
  } catch (error) {
    return jsonError(getErrorMessage(error));
  }
}

function sanitizeHeaderFileName(fileName: string) {
  return fileName.replace(/["\r\n]/g, "").trim() || "cotizacion-afisec.pdf";
}
