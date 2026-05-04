"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type DashboardStats = {
  total: number;
  pendingValidation: number;
  errors: number;
  upcomingExpirations: number;
  expirationWindowDays: number;
};

const statStyles = [
  "border-neutral-200 bg-white",
  "border-amber-200 bg-amber-50",
  "border-rose-200 bg-rose-50",
  "border-teal-200 bg-teal-50",
];

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

  const cards = [
    { label: "Contratos", value: stats?.total },
    { label: "Por validar", value: stats?.pendingValidation },
    { label: "Errores", value: stats?.errors },
    { label: "Vencen pronto", value: stats?.upcomingExpirations },
  ];

  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">
            AFISEC
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-neutral-950">
            Muñeco Digital
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-neutral-600">
            Prelectura asistida por IA para contratos: carga un PDF, revisa la
            extracción y confirma datos estructurados antes de guardarlos.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/upload"
              className="inline-flex h-11 items-center justify-center rounded-lg bg-teal-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
            >
              Cargar contrato
            </Link>
            <Link
              href="/contratos"
              className="inline-flex h-11 items-center justify-center rounded-lg border border-neutral-300 bg-white px-5 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-50"
            >
              Consultar contratos
            </Link>
          </div>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-neutral-950 p-8 text-white shadow-sm">
          <p className="text-sm font-medium text-teal-200">MVP operativo</p>
          <p className="mt-4 text-2xl font-semibold leading-tight">
            Diana y Carolina validan la lectura antes de que un contrato pase a
            estado validado.
          </p>
          <p className="mt-4 text-sm leading-6 text-neutral-300">
            La aplicación no emite pólizas ni calcula primas; concentra el flujo
            en extracción, revisión humana y consulta posterior.
          </p>
        </div>
      </section>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">
          {error}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-4">
        {cards.map((card, index) => (
          <div
            key={card.label}
            className={`rounded-lg border p-5 shadow-sm ${statStyles[index]}`}
          >
            <p className="text-sm font-medium text-neutral-600">{card.label}</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-neutral-950">
              {typeof card.value === "number" ? card.value : "—"}
            </p>
          </div>
        ))}
      </section>
    </div>
  );
}
