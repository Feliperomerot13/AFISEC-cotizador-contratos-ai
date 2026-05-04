"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CONTRACT_STATES, EXECUTIVES } from "@/lib/constants";
import { formatCurrency, formatDate } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";

type ContractListRecord = {
  id: string;
  numero_contrato: string | null;
  valor_contrato: number | null;
  moneda: string;
  fecha_fin: string | null;
  contratista: string | null;
  estado: string;
  mensaje_error: string | null;
  creado_en: string;
  clientes: {
    nombre: string;
    nit: string;
    ejecutivo: string;
  };
};

const stateLabels: Record<string, string> = {
  cargado: "Cargado",
  procesando: "Procesando",
  procesado_ia: "Procesado IA",
  pendiente_validacion: "Pendiente validación",
  validado: "Validado",
  error: "Error",
};

export function ContractsList() {
  const [contracts, setContracts] = useState<ContractListRecord[]>([]);
  const [search, setSearch] = useState("");
  const [executive, setExecutive] = useState("todos");
  const [state, setState] = useState("todos");
  const [expiring, setExpiring] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();

    if (search.trim()) {
      params.set("search", search.trim());
    }

    if (executive !== "todos") {
      params.set("ejecutivo", executive);
    }

    if (state !== "todos") {
      params.set("estado", state);
    }

    if (expiring) {
      params.set("vencen", "30");
    }

    return params.toString();
  }, [executive, expiring, search, state]);

  useEffect(() => {
    let isMounted = true;

    fetch(`/api/contracts${query ? `?${query}` : ""}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();

        if (!response.ok) {
          throw new Error(body.error ?? "No se pudieron consultar contratos.");
        }

        return body.contracts as ContractListRecord[];
      })
      .then((body) => {
        if (isMounted) {
          setContracts(body);
          setError(null);
        }
      })
      .catch((fetchError: Error) => {
        if (isMounted) {
          setError(fetchError.message);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [query]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">
            Consulta
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-950">
            Contratos
          </h1>
        </div>
        <Link
          href="/upload"
          className="inline-flex h-11 items-center justify-center rounded-lg bg-teal-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
        >
          Cargar contrato
        </Link>
      </div>

      <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[1.5fr_0.75fr_0.75fr_0.65fr]">
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
              Buscar
            </span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cliente, NIT, contrato o contratista"
              className="h-10 w-full rounded-lg border border-neutral-300 px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-100"
            />
          </label>

          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
              Ejecutiva
            </span>
            <select
              value={executive}
              onChange={(event) => setExecutive(event.target.value)}
              className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-100"
            >
              <option value="todos">Todas</option>
              {EXECUTIVES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
              Estado
            </span>
            <select
              value={state}
              onChange={(event) => setState(event.target.value)}
              className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-100"
            >
              <option value="todos">Todos</option>
              {CONTRACT_STATES.map((item) => (
                <option key={item} value={item}>
                  {stateLabels[item]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-h-16 items-end gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 pb-3 text-sm font-medium text-neutral-700">
            <input
              type="checkbox"
              checked={expiring}
              onChange={(event) => setExpiring(event.target.checked)}
              className="h-4 w-4 rounded border-neutral-300 text-teal-700 focus:ring-teal-600"
            />
            Vencen en 30 días
          </label>
        </div>
      </section>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">
          {error}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
        <div className="grid grid-cols-12 border-b border-neutral-200 bg-neutral-50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
          <div className="col-span-4">Cliente</div>
          <div className="col-span-2">Contrato</div>
          <div className="col-span-2">Valor</div>
          <div className="col-span-2">Vence</div>
          <div className="col-span-2">Estado</div>
        </div>

        {isLoading ? (
          <div className="p-6 text-sm text-neutral-500">Cargando contratos...</div>
        ) : contracts.length === 0 ? (
          <div className="p-6 text-sm text-neutral-500">
            No hay contratos con esos filtros.
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {contracts.map((contract) => (
              <Link
                key={contract.id}
                href={`/contratos/${contract.id}`}
                className="grid grid-cols-12 gap-2 px-4 py-4 text-sm transition hover:bg-neutral-50"
              >
                <div className="col-span-12 md:col-span-4">
                  <p className="font-semibold text-neutral-950">
                    {contract.clientes.nombre}
                  </p>
                  <p className="mt-1 text-neutral-500">
                    {contract.clientes.nit} · {contract.clientes.ejecutivo}
                  </p>
                </div>
                <div className="col-span-6 md:col-span-2">
                  <p className="font-medium text-neutral-800">
                    {contract.numero_contrato ?? "Sin número"}
                  </p>
                  <p className="mt-1 truncate text-neutral-500">
                    {contract.contratista ?? "Sin contratista"}
                  </p>
                </div>
                <div className="col-span-6 md:col-span-2">
                  {formatCurrency(contract.valor_contrato, contract.moneda)}
                </div>
                <div className="col-span-6 md:col-span-2">
                  {formatDate(contract.fecha_fin)}
                </div>
                <div className="col-span-6 md:col-span-2">
                  <StatusBadge state={contract.estado} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
