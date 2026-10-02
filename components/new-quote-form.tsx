"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Loader2 } from "lucide-react";
import { DEFAULT_EXECUTIVE, EXECUTIVES } from "@/lib/constants";

const inputClass =
  "h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15";

export function NewQuoteForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombreCliente: form.get("nombreCliente"),
          nitCliente: form.get("nitCliente"),
          ejecutivo: form.get("ejecutivo"),
          contratante: form.get("contratante"),
          numero_contrato: form.get("numero_contrato"),
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error ?? "No se pudo crear la cotización.");
      }

      router.push(`/contratos/${body.contractId}`);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Ocurrió un error inesperado.",
      );
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#d25b30]">
          Cotización
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950 sm:text-3xl">
          Nueva cotización
        </h2>
        <p className="mt-2 text-sm text-neutral-500">
          Crea una cotización sin cargar documento. El valor, las fechas, el
          objeto y los amparos se diligencian en la revisión.
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-soft)]"
      >
        <div className="grid gap-5 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-medium text-neutral-700">Tomador</span>
            <input name="nombreCliente" required className={inputClass} />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-neutral-700">
              NIT del tomador
            </span>
            <input name="nitCliente" required className={inputClass} />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-neutral-700">
              Asegurado / contratante
            </span>
            <input name="contratante" required className={inputClass} />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-neutral-700">
              Número de contrato u orden (opcional)
            </span>
            <input name="numero_contrato" className={inputClass} />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-neutral-700">
              Ejecutivo comercial
            </span>
            <select
              name="ejecutivo"
              defaultValue={DEFAULT_EXECUTIVE}
              className={inputClass}
            >
              {EXECUTIVES.map((executive) => (
                <option key={executive} value={executive}>
                  {executive}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error ? (
          <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-6 inline-flex h-11 items-center gap-2 rounded-lg bg-neutral-950 px-5 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
        >
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : null}
          Crear cotización
        </button>
      </form>
    </div>
  );
}
