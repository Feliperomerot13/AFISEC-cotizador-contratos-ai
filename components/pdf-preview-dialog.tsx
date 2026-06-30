"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, Loader2, X } from "lucide-react";

type PdfPreviewDialogProps = {
  url: string;
  fileName?: string;
  label?: string;
  title?: string;
  variant?: "button" | "link";
};

export function PdfPreviewDialog({
  url,
  fileName = "cotizacion-afisec.pdf",
  label = "PDF",
  title = "Vista previa de la cotización",
  variant = "button",
}: PdfPreviewDialogProps) {
  const [open, setOpen] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [objectUrl]);

  async function handleOpen() {
    setOpen(true);
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch(url, { cache: "no-store" });

      if (!response.ok) {
        throw new Error("No se pudo cargar el PDF para la vista previa.");
      }

      const blob = await response.blob();
      setObjectUrl((previous) => {
        if (previous) {
          URL.revokeObjectURL(previous);
        }
        return URL.createObjectURL(blob);
      });
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "No se pudo cargar el PDF.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  function handleClose() {
    setOpen(false);
    setObjectUrl((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous);
      }
      return null;
    });
    setError(null);
  }

  const triggerClassName =
    variant === "link"
      ? "inline-flex items-center gap-1 font-semibold text-[#d25b30] outline-none transition hover:text-[#b94d28] focus-visible:underline"
      : "inline-flex h-9 items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-800 outline-none transition hover:bg-neutral-100 focus-visible:ring-4 focus-visible:ring-[#d25b30]/20";

  return (
    <>
      <button type="button" onClick={handleOpen} className={triggerClassName}>
        <FileText
          className={variant === "link" ? "h-4 w-4" : "h-3.5 w-3.5"}
          aria-hidden
        />
        {label}
      </button>

      {open ? (
        <PdfPreviewModal
          title={title}
          fileName={fileName}
          objectUrl={objectUrl}
          isLoading={isLoading}
          error={error}
          onClose={handleClose}
        />
      ) : null}
    </>
  );
}

function PdfPreviewModal({
  title,
  fileName,
  objectUrl,
  isLoading,
  error,
  onClose,
}: {
  title: string;
  fileName: string;
  objectUrl: string | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
    >
      <button
        type="button"
        aria-label="Cerrar vista previa"
        onClick={onClose}
        className="absolute inset-0 bg-neutral-950/50 backdrop-blur-sm"
      />

      <div className="relative flex h-full max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-card)]">
        <header className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#d25b30]/10 text-[#d25b30]">
              <FileText className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-neutral-900">
                {title}
              </p>
              <p className="truncate text-xs text-neutral-500">{fileName}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {objectUrl ? (
              <a
                href={objectUrl}
                download={fileName}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#d25b30] px-4 text-sm font-semibold text-white transition hover:bg-[#b94d28] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#d25b30]/25"
              >
                <Download className="h-4 w-4" aria-hidden />
                Descargar
              </a>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </header>

        <div className="relative flex-1 bg-neutral-100">
          {isLoading ? (
            <div className="flex h-full items-center justify-center gap-3 text-sm text-neutral-500">
              <Loader2 className="h-5 w-5 animate-ai-spin text-[#d25b30]" aria-hidden />
              Cargando vista previa...
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm font-medium text-rose-700">
              {error}
            </div>
          ) : objectUrl ? (
            <iframe
              src={objectUrl}
              title={title}
              className="h-full w-full"
            />
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
