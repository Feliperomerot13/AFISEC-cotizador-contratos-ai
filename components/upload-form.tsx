"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { DOCUMENT_TYPES, EXECUTIVES } from "@/lib/constants";

const documentTypeLabels: Record<string, string> = {
  contrato_base: "Contrato base",
  otrosi: "Otrosí",
  otro: "Otro",
};

export function UploadForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setStatus("Subiendo PDF y creando registros...");

    try {
      const formData = new FormData(event.currentTarget);
      const uploadResponse = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const uploadBody = await uploadResponse.json();

      if (!uploadResponse.ok) {
        throw new Error(uploadBody.error ?? "No se pudo subir el contrato.");
      }

      setStatus("Iniciando extracción con IA...");

      const processResponse = await fetch(
        `/api/contracts/${uploadBody.contractId}/process`,
        { method: "POST" },
      );
      const processBody = await processResponse.json();

      if (!processResponse.ok) {
        throw new Error(
          processBody.error ?? "No se pudo iniciar el procesamiento.",
        );
      }

      router.push(`/contratos/${uploadBody.contractId}`);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Ocurrió un error inesperado.",
      );
      setStatus(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">
          Carga
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-950">
          Nuevo contrato
        </h1>
      </div>

      <form
        onSubmit={onSubmit}
        className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
      >
        <div className="grid gap-5 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-medium text-neutral-700">
              Cliente
            </span>
            <input
              name="nombreCliente"
              required
              className="h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-100"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-neutral-700">NIT</span>
            <input
              name="nitCliente"
              required
              className="h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-100"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-neutral-700">
              Ejecutiva
            </span>
            <select
              name="ejecutivo"
              required
              defaultValue="Diana"
              className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-100"
            >
              {EXECUTIVES.map((executive) => (
                <option key={executive} value={executive}>
                  {executive}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-neutral-700">
              Tipo de documento
            </span>
            <select
              name="tipoDocumento"
              required
              defaultValue="contrato_base"
              className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-100"
            >
              {DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {documentTypeLabels[type]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-5 block space-y-2">
          <span className="text-sm font-medium text-neutral-700">
            Archivo PDF
          </span>
          <input
            name="pdf"
            type="file"
            accept="application/pdf,.pdf"
            required
            className="block w-full rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-3 py-4 text-sm text-neutral-700 outline-none transition file:mr-4 file:rounded-lg file:border-0 file:bg-teal-700 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:bg-neutral-100 focus:border-teal-600 focus:ring-4 focus:ring-teal-100"
          />
        </label>

        {status ? (
          <div className="mt-5 rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm font-medium text-sky-700">
            {status}
          </div>
        ) : null}

        {error ? (
          <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="mt-6 flex justify-end">
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-teal-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
          >
            {isSubmitting ? "Procesando..." : "Cargar y procesar"}
          </button>
        </div>
      </form>
    </div>
  );
}
