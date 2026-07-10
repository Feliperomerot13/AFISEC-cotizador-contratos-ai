"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  FileSpreadsheet,
  FileStack,
  FileText,
  PencilLine,
  Plus,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

type DashboardStats = {
  total: number;
  pendingValidation: number;
  baseQuotesGenerated: number;
  basePoliciesIssued: number;
  amendmentsInReview: number;
  issuedAmendments: number;
  version: {
    appVersion: string;
    release: string;
    buildTime: string | null;
    commit: string | null;
  };
};

type Accent = "brand" | "amber" | "sky" | "emerald";

type StatCard = {
  label: string;
  value: number | undefined;
  icon: LucideIcon;
  accent: Accent;
  href?: string;
};

const accentChip: Record<Accent, string> = {
  brand: "bg-[#d25b30]/10 text-[#d25b30]",
  amber: "bg-amber-100 text-amber-700",
  sky: "bg-sky-100 text-sky-700",
  emerald: "bg-emerald-100 text-emerald-700",
};

export function DashboardClient() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    fetch("/api/dashboard", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();

        if (!response.ok) {
          throw new Error(body.error ?? "No se pudieron cargar los indicadores.");
        }

        return body as DashboardStats;
      })
      .then((body) => {
        if (isMounted) {
          setStats(body);
        }
      })
      .catch((fetchError: Error) => {
        if (isMounted) {
          setError(fetchError.message);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const isLoading = !stats && !error;

  const cards: StatCard[] = [
    {
      label: "Contratos cargados",
      value: stats?.total,
      icon: FileText,
      accent: "brand",
      href: "/contratos",
    },
    {
      label: "Por validar",
      value: stats?.pendingValidation,
      icon: PencilLine,
      accent: "amber",
      href: "/contratos?estado=pendiente_validacion",
    },
    {
      label: "Cotizaciones base",
      value: stats?.baseQuotesGenerated,
      icon: FileSpreadsheet,
      accent: "sky",
      href: "/contratos?panel=con_cotizacion",
    },
    {
      label: "Pólizas base emitidas",
      value: stats?.basePoliciesIssued,
      icon: ShieldCheck,
      accent: "emerald",
      href: "/contratos?panel=emitida",
    },
    {
      label: "Otrosíes en revisión",
      value: stats?.amendmentsInReview,
      icon: FileStack,
      accent: "amber",
    },
    {
      label: "Otrosíes emitidos",
      value: stats?.issuedAmendments,
      icon: CheckCircle2,
      accent: "emerald",
    },
  ];

  return (
    <div className="space-y-8">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#d25b30]">
            Resumen
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950 sm:text-3xl">
            Inicio
          </h2>
          <p className="mt-2 text-sm text-neutral-500">
            Indicadores operativos y accesos rápidos del flujo de cotización.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/upload"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#d25b30] px-5 text-sm font-semibold text-white shadow-[var(--shadow-soft)] transition hover:bg-[#b94d28] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#d25b30]/25"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Cargar contrato
          </Link>
          <Link
            href="/contratos"
            className="inline-flex h-11 items-center justify-center rounded-lg border border-neutral-300 bg-white px-5 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-neutral-200"
          >
            Consultar contratos
          </Link>
        </div>
      </header>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">
          {error}
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map((card) => (
          <StatTile key={card.label} card={card} isLoading={isLoading} />
        ))}
      </section>

      {stats?.version ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--border)] pt-4 text-xs text-neutral-500">
          <span className="font-semibold text-neutral-700">
            v{stats.version.appVersion}
          </span>
          {stats.version.buildTime ? (
            <span>Build {formatBuildTime(stats.version.buildTime)}</span>
          ) : null}
          {stats.version.commit ? (
            <span className="font-mono">Commit {stats.version.commit}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StatTile({
  card,
  isLoading,
}: {
  card: StatCard;
  isLoading: boolean;
}) {
  const Icon = card.icon;
  const content = (
    <>
      <div className="flex items-start justify-between">
        <span
          className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${accentChip[card.accent]}`}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        {card.href ? (
          <ArrowUpRight
            className="h-4 w-4 text-neutral-300 transition group-hover:text-[#d25b30]"
            aria-hidden
          />
        ) : null}
      </div>
      <p className="mt-4 text-sm font-medium text-neutral-600">{card.label}</p>
      {isLoading ? (
        <span className="mt-2 block h-9 w-12 animate-pulse rounded-md bg-neutral-100" />
      ) : (
        <p className="mt-1 text-3xl font-semibold tracking-tight text-neutral-950">
          {typeof card.value === "number" ? card.value : "—"}
        </p>
      )}
    </>
  );

  if (card.href) {
    return (
      <Link
        href={card.href}
        className="group rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-soft)] transition hover:border-[#d25b30]/30 hover:shadow-[var(--shadow-card)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#d25b30]/20"
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-soft)]">
      {content}
    </div>
  );
}

function formatBuildTime(value: string) {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Bogota",
  }).format(new Date(value));
}
