"use client";

import type { ReactNode } from "react";

const CONFIDENCE_STYLES: Record<string, { dot: string; label: string }> = {
  alta: { dot: "bg-emerald-500", label: "Confianza alta" },
  media: { dot: "bg-amber-400", label: "Confianza media" },
  baja: { dot: "bg-rose-500 ring-2 ring-rose-200", label: "Confianza baja: verificar" },
};

export function getConfidenceLabel(confidence: string | null | undefined) {
  return confidence ? (CONFIDENCE_STYLES[confidence]?.label ?? null) : null;
}

// Punto de confianza de la extracción IA; solo lectura. No renderiza nada sin dato válido.
export function ConfidenceDot({
  confidence,
}: {
  confidence: string | null | undefined;
}) {
  const style = confidence ? CONFIDENCE_STYLES[confidence] : undefined;

  if (!style) {
    return null;
  }

  return (
    <span
      role="img"
      aria-label={style.label}
      title={style.label}
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`}
    />
  );
}

export function ReviewChip({
  tone,
  children,
}: {
  tone: "ok" | "review" | "info";
  children: ReactNode;
}) {
  const classes = {
    ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
    review: "border-amber-300 bg-amber-50 text-amber-800",
    info: "border-neutral-200 bg-neutral-50 text-neutral-600",
  }[tone];

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${classes}`}
    >
      {children}
    </span>
  );
}
