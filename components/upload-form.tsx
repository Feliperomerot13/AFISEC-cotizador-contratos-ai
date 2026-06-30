"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { AiLoader } from "@/components/ai-loader";
import { DEFAULT_EXECUTIVE, DOCUMENT_TYPES, EXECUTIVES } from "@/lib/constants";

const documentTypeLabels: Record<string, string> = {
  contrato_base: "Contrato base",
  orden: "Orden de servicio",
  orden_compra: "Orden de compra",
  otrosi: "Otrosí",
};

type BaseContractOption = {
  id: string | number;
  numero_contrato: string | null;
  contratista: string | null;
  estado: string;
  clientes: {
    nombre: string;
    nit: string;
    ejecutivo: string;
  };
  cotizaciones?: Array<{
    id: string | number;
    estado: string;
  }>;
};

export function UploadForm() {
  const router = useRouter();
  const [documentType, setDocumentType] = useState("contrato_base");
  const [baseContracts, setBaseContracts] = useState<BaseContractOption[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClientNit, setSelectedClientNit] = useState("");
  const [selectedContractId, setSelectedContractId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    fetch("/api/contracts", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();

        if (!response.ok) {
          throw new Error(body.error ?? "No se pudieron consultar contratos.");
        }

        return body.contracts as BaseContractOption[];
      })
      .then((contracts) => {
        if (isMounted) {
          setBaseContracts(contracts);
        }
      })
      .catch(() => {
        if (isMounted) {
          setBaseContracts([]);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const issuedBaseContracts = useMemo(
    () =>
      baseContracts.filter((contract) =>
        contract.cotizaciones?.some((quote) => quote.estado === "emitida"),
      ),
    [baseContracts],
  );

  const clientOptions = useMemo(() => {
    const byNit = new Map<
      string,
      BaseContractOption["clientes"] & { nit: string }
    >();

    issuedBaseContracts.forEach((contract) => {
      if (!contract.clientes.nit) {
        return;
      }

      byNit.set(contract.clientes.nit, {
        ...contract.clientes,
        nit: contract.clientes.nit,
      });
    });

    return Array.from(byNit.values()).sort((left, right) =>
      left.nombre.localeCompare(right.nombre, "es"),
    );
  }, [issuedBaseContracts]);

  const contractsForClient = useMemo(
    () =>
      issuedBaseContracts.filter(
        (contract) => contract.clientes.nit === selectedClientNit,
      ),
    [issuedBaseContracts, selectedClientNit],
  );
  const filteredClientOptions = useMemo(() => {
    const query = clientSearch
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();

    if (!query) {
      return clientOptions;
    }

    return clientOptions.filter((client) =>
      `${client.nombre} ${client.nit}`
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .includes(query),
    );
  }, [clientOptions, clientSearch]);
  const selectedContract = issuedBaseContracts.find(
    (contract) => String(contract.id) === selectedContractId,
  );
  const isAmendment = documentType === "otrosi";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setStatus("Subiendo PDF y creando registros...");

    try {
      const formData = new FormData(event.currentTarget);

      if (isAmendment && !selectedContract) {
        throw new Error("Selecciona el contrato base afectado por el otrosí.");
      }

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
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#d25b30]">
          Carga
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950 sm:text-3xl">
          {isAmendment ? "Cargar otrosí" : "Nuevo documento"}
        </h2>
      </div>

      <form
        onSubmit={onSubmit}
        className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-soft)]"
      >
        <div className="grid gap-5 md:grid-cols-2">
          <label className="space-y-2 md:col-span-2">
            <span className="text-sm font-medium text-neutral-700">
              Tipo de documento
            </span>
            <select
              name="tipoDocumento"
              required
              value={documentType}
              onChange={(event) => {
                setDocumentType(event.target.value);
                setClientSearch("");
                setSelectedClientNit("");
                setSelectedContractId("");
              }}
              className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
            >
              {DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {documentTypeLabels[type]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {isAmendment ? (
          <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800">
            La carga de otrosí opera sobre contratos con póliza base emitida y
            sin otrosíes pendientes.
          </div>
        ) : null}

        <div className="mt-5 grid gap-5 md:grid-cols-2">
          {isAmendment ? (
            <>
              <input
                type="hidden"
                name="nombreCliente"
                value={selectedContract?.clientes.nombre ?? ""}
              />
              <input
                type="hidden"
                name="nitCliente"
                value={selectedContract?.clientes.nit ?? ""}
              />
              <input
                type="hidden"
                name="ejecutivo"
                value={normalizeExecutiveForForm(
                  selectedContract?.clientes.ejecutivo,
                )}
              />
              <input
                type="hidden"
                name="contratoBaseId"
                value={selectedContractId}
              />
              <label className="space-y-2">
                <span className="text-sm font-medium text-neutral-700">
                  Buscar cliente
                </span>
                <input
                  value={clientSearch}
                  onChange={(event) => {
                    setClientSearch(event.target.value);
                    setSelectedClientNit("");
                    setSelectedContractId("");
                  }}
                  placeholder="Nombre o NIT"
                  className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-neutral-700">
                  Cliente
                </span>
                <select
                  required
                  value={selectedClientNit}
                  onChange={(event) => {
                    setSelectedClientNit(event.target.value);
                    setSelectedContractId("");
                  }}
                  className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
                >
                  <option value="">Selecciona cliente</option>
                  {filteredClientOptions.map((client) => (
                    <option key={client.nit} value={client.nit}>
                      {client.nombre} · {client.nit}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-neutral-700">
                  Contrato base afectado
                </span>
                <select
                  required
                  value={selectedContractId}
                  onChange={(event) => setSelectedContractId(event.target.value)}
                  className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
                >
                  <option value="">Selecciona contrato</option>
                  {contractsForClient.map((contract) => (
                    <option key={contract.id} value={String(contract.id)}>
                      {contract.numero_contrato ?? "Sin número"} ·{" "}
                      {contract.contratista ?? "Sin contratista"}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <>
              <label className="space-y-2">
                <span className="text-sm font-medium text-neutral-700">
                  Cliente
                </span>
                <input
                  name="nombreCliente"
                  required
                  className="h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-neutral-700">NIT</span>
                <input
                  name="nitCliente"
                  required
                  className="h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
                />
              </label>
            </>
          )}

          {isAmendment ? null : (
          <label className="space-y-2">
            <span className="text-sm font-medium text-neutral-700">
              Ejecutivo comercial
            </span>
            <select
              name="ejecutivo"
              required
              defaultValue={DEFAULT_EXECUTIVE}
              className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
            >
              {EXECUTIVES.map((executive) => (
                <option key={executive} value={executive}>
                  {executive}
                </option>
              ))}
            </select>
          </label>
          )}
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
            className="block w-full rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-3 py-4 text-sm text-neutral-700 outline-none transition file:mr-4 file:rounded-lg file:border-0 file:bg-[#d25b30] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:bg-neutral-100 focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
          />
        </label>

        {status ? (
          <div className="mt-5">
            <AiLoader
              title={status}
              description="No cierres esta ventana. Estamos leyendo el documento y preparando la extracción asistida con inteligencia artificial."
            />
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
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#d25b30] px-5 text-sm font-semibold text-white shadow-[var(--shadow-soft)] transition hover:bg-[#b94d28] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#d25b30]/25 disabled:cursor-not-allowed disabled:bg-neutral-400"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-ai-spin" aria-hidden />
                Procesando...
              </>
            ) : (
              "Cargar y procesar"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

function normalizeExecutiveForForm(value: string | null | undefined): string {
  return value && EXECUTIVES.some((executive) => executive === value)
    ? value
    : DEFAULT_EXECUTIVE;
}
