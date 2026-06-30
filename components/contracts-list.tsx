"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { FileSearch, Plus, Search, X } from "lucide-react";
import { CONTRACT_STATES, EXECUTIVES } from "@/lib/constants";
import { diffDaysDateOnly } from "@/lib/date-only";
import { formatCurrency, formatDate } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";

type ContractListRecord = {
  id: string | number;
  numero_contrato: string | null;
  valor_contrato: number | null;
  moneda: string;
  fecha_fin: string | null;
  renovable_automaticamente: boolean;
  contratista: string | null;
  estado: string;
  mensaje_error: string | null;
  creado_en: string;
  clientes: {
    nombre: string;
    nit: string | null;
    ejecutivo: string;
  };
  cotizaciones?: Array<{
    id: string | number;
    estado: string;
  }>;
};

type PanelFilter = "con_cotizacion" | "emitida";

const panelFilterLabels: Record<PanelFilter, string> = {
  con_cotizacion: "Con cotización base",
  emitida: "Con póliza base emitida",
};

function isPanelFilter(value: string | null): value is PanelFilter {
  return value === "con_cotizacion" || value === "emitida";
}

const stateLabels: Record<string, string> = {
  cargado: "Cargado",
  procesando: "Procesando",
  procesado_ia: "Procesado IA",
  pendiente_validacion: "Pendiente validación",
  validado: "Validado",
  error: "Error",
};

export function ContractsList() {
  const searchParams = useSearchParams();
  const initialState = searchParams.get("estado");
  const initialPanel = searchParams.get("panel");

  const [contracts, setContracts] = useState<ContractListRecord[]>([]);
  const [search, setSearch] = useState("");
  const [executive, setExecutive] = useState("todos");
  const [state, setState] = useState(() =>
    initialState && CONTRACT_STATES.includes(initialState as never)
      ? initialState
      : "todos",
  );
  const [panel, setPanel] = useState<PanelFilter | "">(() =>
    isPanelFilter(initialPanel) ? initialPanel : "",
  );
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

  const visibleContracts = useMemo(() => {
    if (panel === "con_cotizacion") {
      return contracts.filter(
        (contract) => (contract.cotizaciones?.length ?? 0) > 0,
      );
    }

    if (panel === "emitida") {
      return contracts.filter((contract) =>
        contract.cotizaciones?.some((quote) => quote.estado === "emitida"),
      );
    }

    return contracts;
  }, [contracts, panel]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#d25b30]">
            Consulta
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950 sm:text-3xl">
            Contratos
          </h2>
        </div>
        <Link
          href="/upload"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#d25b30] px-5 text-sm font-semibold text-white shadow-[var(--shadow-soft)] transition hover:bg-[#b94d28] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#d25b30]/25"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Cargar contrato
        </Link>
      </div>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-soft)]">
        <div className="grid gap-3 md:grid-cols-[1.5fr_0.75fr_0.75fr_0.65fr]">
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
              Buscar
            </span>
            <span className="relative block">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
                aria-hidden
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Cliente, NIT, contrato o contratista"
                className="h-10 w-full rounded-lg border border-neutral-300 pl-9 pr-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
              />
            </span>
          </label>

          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
              Ejecutiva
            </span>
            <select
              value={executive}
              onChange={(event) => setExecutive(event.target.value)}
              className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
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
              className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
            >
              <option value="todos">Todos</option>
              {CONTRACT_STATES.map((item) => (
                <option key={item} value={item}>
                  {stateLabels[item]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex cursor-pointer items-center gap-2 self-end rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100">
            <input
              type="checkbox"
              checked={expiring}
              onChange={(event) => setExpiring(event.target.checked)}
              className="h-4 w-4 rounded border-neutral-300 text-[#d25b30] focus:ring-[#d25b30]"
            />
            Vencen en 30 días
          </label>
        </div>
      </section>

      {panel ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-neutral-500">Filtro activo:</span>
          <span className="inline-flex items-center gap-2 rounded-full border border-[#d25b30]/30 bg-[#d25b30]/5 py-1 pl-3 pr-1.5 font-medium text-[#b94d28]">
            {panelFilterLabels[panel]}
            <button
              type="button"
              onClick={() => setPanel("")}
              aria-label="Quitar filtro"
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[#b94d28] transition hover:bg-[#d25b30]/15"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </span>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">
          {error}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-soft)]">
        <div className="hidden grid-cols-12 gap-2 border-b border-[var(--border)] bg-neutral-50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500 md:grid">
          <div className="col-span-4">Cliente</div>
          <div className="col-span-2">Contrato</div>
          <div className="col-span-2 text-right">Valor</div>
          <div className="col-span-2">Vence</div>
          <div className="col-span-2">Estado</div>
        </div>

        {isLoading ? (
          <div className="divide-y divide-neutral-100">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="flex items-center gap-4 px-4 py-4">
                <span className="h-9 flex-1 animate-pulse rounded-md bg-neutral-100" />
                <span className="hidden h-9 w-24 animate-pulse rounded-md bg-neutral-100 md:block" />
                <span className="hidden h-9 w-20 animate-pulse rounded-md bg-neutral-100 md:block" />
              </div>
            ))}
          </div>
        ) : visibleContracts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
              <FileSearch className="h-6 w-6" aria-hidden />
            </span>
            <p className="text-sm font-medium text-neutral-700">
              No hay contratos con esos filtros.
            </p>
            <p className="text-sm text-neutral-500">
              Ajusta la búsqueda o carga un nuevo documento.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {visibleContracts.map((contract) => {
              const isRenewableExpiring = isExpiringRenewableContract(contract);

              return (
                <Link
                  key={contract.id}
                  href={`/contratos/${contract.id}`}
                  className="grid grid-cols-2 gap-2 px-4 py-4 text-sm transition hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#d25b30]/40 md:grid-cols-12 md:items-center"
                >
                  <div className="col-span-2 md:col-span-4">
                    <p className="font-semibold text-neutral-950">
                      {contract.clientes.nombre}
                    </p>
                    <p className="mt-1 text-neutral-500">
                      {contract.clientes.nit} · {contract.clientes.ejecutivo}
                    </p>
                    {isRenewableExpiring ? (
                      <span className="mt-2 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                        Renovable por vencer
                      </span>
                    ) : null}
                  </div>
                  <div className="md:col-span-2">
                    <p className="font-medium text-neutral-800">
                      {contract.numero_contrato ?? "Sin número"}
                    </p>
                    <p className="mt-1 truncate text-neutral-500">
                      {contract.contratista ?? "Sin contratista"}
                    </p>
                  </div>
                  <div className="text-right font-medium tabular-nums text-neutral-800 md:col-span-2">
                    {formatCurrency(contract.valor_contrato, contract.moneda)}
                  </div>
                  <div className="tabular-nums text-neutral-600 md:col-span-2">
                    {formatDate(contract.fecha_fin)}
                  </div>
                  <div className="md:col-span-2">
                    <StatusBadge state={contract.estado} />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function isExpiringRenewableContract(contract: ContractListRecord) {
  if (!contract.renovable_automaticamente || !contract.fecha_fin) {
    return false;
  }

  const days = diffDaysDateOnly(
    new Date().toISOString().slice(0, 10),
    contract.fecha_fin,
  );

  return days !== null && days >= 0 && days <= 30;
}
