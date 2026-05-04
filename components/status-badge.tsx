import { stateLabel } from "@/lib/format";

const stateClasses: Record<string, string> = {
  cargado: "border-sky-200 bg-sky-50 text-sky-700",
  procesando: "border-indigo-200 bg-indigo-50 text-indigo-700",
  procesado_ia: "border-teal-200 bg-teal-50 text-teal-700",
  pendiente_validacion: "border-amber-200 bg-amber-50 text-amber-800",
  validado: "border-emerald-200 bg-emerald-50 text-emerald-700",
  error: "border-rose-200 bg-rose-50 text-rose-700",
};

const confidenceClasses: Record<string, string> = {
  alta: "border-emerald-200 bg-emerald-50 text-emerald-700",
  media: "border-amber-200 bg-amber-50 text-amber-800",
  baja: "border-rose-200 bg-rose-50 text-rose-700",
};

export function StatusBadge({ state }: { state: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${stateClasses[state] ?? "border-neutral-200 bg-neutral-50 text-neutral-700"}`}
    >
      {stateLabel(state)}
    </span>
  );
}

export function ConfidenceBadge({
  confidence,
}: {
  confidence: string | null | undefined;
}) {
  if (!confidence) {
    return (
      <span className="inline-flex items-center rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-semibold text-neutral-600">
        Sin dato
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${confidenceClasses[confidence] ?? "border-neutral-200 bg-neutral-50 text-neutral-700"}`}
    >
      {confidence}
    </span>
  );
}
