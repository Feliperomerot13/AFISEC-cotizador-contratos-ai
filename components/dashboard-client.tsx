"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

type DashboardStats = {
  total: number;
  pendingValidation: number;
  quotesGenerated: number;
  issuedPolicies: number;
};

const statStyles = [
  "border-neutral-200 bg-white",
  "border-[#d25b30]/30 bg-[#d25b30]/5",
  "border-rose-200 bg-rose-50",
  "border-neutral-200 bg-neutral-50",
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
    { label: "Contratos cargados", value: stats?.total },
    { label: "Por validar", value: stats?.pendingValidation },
    { label: "Cotizaciones generadas", value: stats?.quotesGenerated },
    { label: "Pólizas emitidas", value: stats?.issuedPolicies },
  ];

  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
          <Image
            src="/brand/Logo_Color_Afisec_cuadrado.png"
            alt="AFISEC"
            width={68}
            height={80}
            className="h-16 w-auto"
            priority
          />
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-neutral-950">
            AFISEC | Gestión de cotizaciones contractuales
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-neutral-600">
            Centraliza la revisión de contratos, la validación de amparos y la
            generación de cotizaciones para pólizas de cumplimiento.
          </p>
          <p className="mt-3 max-w-2xl text-base leading-7 text-neutral-600">
            Gestiona el flujo completo desde la carga documental hasta la
            cotización versionada y la emisión de la póliza base.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/upload"
              className="inline-flex h-11 items-center justify-center rounded-lg bg-[#d25b30] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#b94d28]"
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
          <p className="text-sm font-medium text-[#f0c5b6]">
            Flujo comercial AFISEC
          </p>
          <p className="mt-4 text-2xl font-semibold leading-tight">
            Del contrato a la cotización validada.
          </p>
          <p className="mt-4 text-sm leading-6 text-neutral-300">
            Carga contratos u órdenes, revisa la información extraída, valida
            amparos y genera cotizaciones versionadas antes de emitir la póliza
            base.
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
