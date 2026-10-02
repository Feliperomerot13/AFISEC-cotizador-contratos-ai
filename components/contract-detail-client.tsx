"use client";

import { useRouter } from "next/navigation";
import {
  FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Loader2 } from "lucide-react";
import {
  DEFAULT_EXECUTIVE,
  DEFAULT_COVERAGE_RATE,
  DEFAULT_IVA_PERCENTAGE,
  DEFAULT_RCE_RATE,
  EXECUTIVES,
} from "@/lib/constants";
import { addDaysToDateOnly, diffDaysDateOnly } from "@/lib/date-only";
import {
  normalizeCoverage,
  type CoverageSubamparo,
} from "@/lib/coverage-calculations";
import type {
  Amparo,
  Cliente,
  Contrato,
  Cotizacion,
  CotizacionAjuste,
  Documento,
  ModificacionContractual,
  TasaReferencia,
} from "@/lib/database.types";
import {
  formatCurrency,
  formatDate,
  normalizeText,
  parseLocalizedNumber,
  percentFromDecimal,
} from "@/lib/format";
import {
  normalizeCurrency as normalizeCurrencyValue,
  normalizeDate as normalizeDateValue,
  normalizeBoolean as normalizeBooleanValue,
  normalizeInteger as normalizeIntegerValue,
  normalizeNumber as normalizeNumberValue,
  normalizeText as normalizeTextValue,
} from "@/lib/normalizers";
import {
  COVERAGE_POLICY_LABELS,
  COVERAGE_POLICY_ORDER,
  classifyCoveragePolicy,
  isCivilLiabilityName,
  type CoveragePolicy,
} from "@/lib/coverage-policy";
import type { PeriodUnit } from "@/lib/spanish-dates";
import {
  formatCoverageName,
  getCoveragePolicy,
  getQuoteSnapshot,
  groupQuoteCoveragesByPolicy,
  quoteStatusLabel,
} from "@/lib/quotes";
import type {
  QuotePolicyGroup,
  QuoteSnapshot,
  QuoteSnapshotSubcoverage,
} from "@/lib/quotes";
import type { AIExtraction } from "@/lib/schemas";
import { AmendmentsPanel } from "@/components/amendments-panel";
import { AiLoader } from "@/components/ai-loader";
import { PdfPreviewDialog } from "@/components/pdf-preview-dialog";
import {
  ConfidenceDot,
  ReviewChip,
  getConfidenceLabel,
} from "@/components/review-ui";
import { StatusBadge } from "@/components/status-badge";

type DocumentMetadata = Omit<Documento, "storage_path">;

type DetailResponse = {
  contract: Contrato;
  client: Cliente;
  documents: DocumentMetadata[];
  amparos: Amparo[];
  tasasReferencia: TasaReferencia[];
  extraction: AIExtraction | null;
  cotizaciones: Cotizacion[];
  modificaciones: ModificacionContractual[];
  cotizacionesAjuste: CotizacionAjuste[];
};

type ContractForm = {
  numero_contrato: string;
  objeto: string;
  tipo_contrato: "" | "estatal" | "particular";
  valor_contrato: string;
  base_calculo_amparos: string;
  base_calculo_incluye_iva: "" | "si" | "no" | "no_determinado";
  moneda: string;
  fecha_inicio: string;
  fecha_fin: string;
  fecha_fin_manual: boolean;
  plazo_dias: string;
  plazo: string;
  renovable_automaticamente: "si" | "no";
  origen_manual: boolean;
  contratante: string;
  contratante_nit: string;
  contratista: string;
  contratista_nit: string;
};

type EditableContractFormKey = Exclude<keyof ContractForm, "fecha_fin_manual">;

type EditableAmparo = {
  // Clave estable en el cliente: la fila conserva su estado de UI aunque cambie el orden o se quite otra.
  uid: string;
  id?: string | number;
  tipo_amparo: string;
  porcentaje: string;
  cuantia_fija: string;
  valor_asegurado: string;
  tasa: string;
  tasa_manual: boolean;
  iva_porcentaje: string;
  tipo_vigencia: "" | "contractual" | "post_contractual";
  base_vigencia:
    | ""
    | "fecha_inicio_contrato"
    | "fecha_fin_contrato"
    | "acta_recibo_final"
    | "firma_contrato"
    | "otra";
  fecha_desde: string;
  fecha_desde_manual: boolean;
  fecha_hasta: string;
  fecha_hasta_manual: boolean;
  periodo_cantidad: string;
  periodo_unidad: PeriodUnit;
  dias_vigencia: string;
  prima_neta: string;
  prima_neta_manual: string;
  usar_prima_neta_manual: boolean;
  impuesto: string;
  prima_total: string;
  valor_base_calculo: string;
  modo_calculo: string;
  fuente_pagina: string;
  fuente_texto: string;
  subamparos: CoverageSubamparo[];
  confianza: "" | "alta" | "media" | "baja";
  requiere_revision: boolean;
  motivo_revision: string;
};

type SourceMeta = {
  confianza?: string | null;
  pagina?: number | null;
  fuente?: string | null;
};

type ContractDetailTab = "contrato" | "cotizaciones" | "otrosies";

const CONTRACT_DETAIL_TABS: Array<{
  id: ContractDetailTab;
  label: string;
}> = [
  { id: "contrato", label: "Contrato y amparos" },
  { id: "cotizaciones", label: "Cotizaciones y póliza" },
  { id: "otrosies", label: "Otrosíes" },
];

const emptyForm: ContractForm = {
  numero_contrato: "",
  objeto: "",
  tipo_contrato: "",
  valor_contrato: "",
  base_calculo_amparos: "",
  base_calculo_incluye_iva: "no_determinado",
  moneda: "COP",
  fecha_inicio: "",
  fecha_fin: "",
  fecha_fin_manual: false,
  plazo_dias: "",
  plazo: "",
  renovable_automaticamente: "no",
  origen_manual: false,
  contratante: "",
  contratante_nit: "",
  contratista: "",
  contratista_nit: "",
};

export function ContractDetailClient({ contractId }: { contractId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [form, setForm] = useState<ContractForm>(emptyForm);
  const [amparos, setAmparos] = useState<EditableAmparo[]>([]);
  const [validadoPor, setValidadoPor] = useState<string>(DEFAULT_EXECUTIVE);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [quoteAction, setQuoteAction] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [baseline, setBaseline] = useState("");
  const [activeTab, setActiveTab] = useState<ContractDetailTab>(
    getInitialContractDetailTab,
  );

  const dirtyRef = useRef(false);
  // Mientras el editor de un amparo está abierto conserva su grupo para no perder el foco al cambiar el tipo.
  const [frozenPolicies, setFrozenPolicies] = useState<
    Record<string, CoveragePolicy>
  >({});
  const setAmparoEditing = useCallback(
    (uid: string, editing: boolean, policy: CoveragePolicy) => {
      setFrozenPolicies((current) => {
        if (!editing) {
          if (!(uid in current)) {
            return current;
          }

          const rest = { ...current };
          delete rest[uid];

          return rest;
        }

        return uid in current ? current : { ...current, [uid]: policy };
      });
    },
    [],
  );

  // keepEdits conserva lo que el usuario ya editó cuando solo cambian cotizaciones u otrosíes.
  const applyDetail = useCallback(
    (nextDetail: DetailResponse, keepEdits = false) => {
      setDetail(nextDetail);

      if (keepEdits) {
        return;
      }

      const nextForm = contractToForm(
        nextDetail.contract,
        nextDetail.extraction,
        nextDetail.amparos,
      );
      const nextAmparos = nextDetail.amparos.map((amparo) =>
        amparoToEditable(amparo, nextDetail.tasasReferencia),
      );

      setForm(nextForm);
      setAmparos(nextAmparos);
      const nextValidator = getInitialValidator(nextDetail);

      setBaseline(
        JSON.stringify({
          form: nextForm,
          amparos: nextAmparos,
          validadoPor: nextValidator,
        }),
      );
      setValidationError(null);
      setValidadoPor(nextValidator);
    },
    [],
  );

  const reloadDetail = useCallback(
    async (keepEdits: boolean) => {
      const nextDetail = await fetchContractDetail(contractId);
      applyDetail(nextDetail, keepEdits);
      setError(null);
    },
    [applyDetail, contractId],
  );

  const loadDetail = useCallback(
    () => reloadDetail(dirtyRef.current),
    [reloadDetail],
  );

  const currentSnapshot = useMemo(
    () => JSON.stringify({ form, amparos, validadoPor }),
    [form, amparos, validadoPor],
  );
  const dirty = detail !== null && baseline !== "" && currentSnapshot !== baseline;

  useEffect(() => {
    dirtyRef.current = dirty;

    if (!dirty) {
      return;
    }

    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnBeforeLeaving);

    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty]);

  useEffect(() => {
    let isMounted = true;

    fetchContractDetail(contractId)
      .then((nextDetail) => {
        if (isMounted) {
          applyDetail(nextDetail);
          setError(null);
        }
      })
      .catch((loadError: Error) => {
        if (isMounted) {
          setError(loadError.message);
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
  }, [applyDetail, contractId]);

  useEffect(() => {
    if (!detail || !["cargado", "procesando", "procesado_ia"].includes(detail.contract.estado)) {
      return;
    }

    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/contracts/${contractId}/status`, {
        cache: "no-store",
      });
      const body = await response.json();

      if (response.ok && body.estado !== detail.contract.estado) {
        await loadDetail();
      }
    }, 3000);

    return () => window.clearInterval(timer);
  }, [contractId, detail, loadDetail]);

  const ai = detail?.extraction ?? null;
  const baseDocument =
    detail?.documents.find((document) => document.tipo_documento !== "otrosi") ??
    detail?.documents[0] ??
    null;
  const isManual = detail?.contract.origen === "manual";
  const startDependsOnActaInicio = contractDependsOnActaInicio(form, ai);

  async function onValidate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setValidationError(null);
    setSuccess(null);

    try {
      const validationIssues = [
        ...getContractDateIssues(form),
        ...getManualDateIssues(amparos),
        ...getRateInputIssues(amparos),
      ];

      if (validationIssues.length > 0) {
        throw new Error(validationIssues.join(" "));
      }

      const response = await fetch(`/api/contracts/${contractId}/validate`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          validado_por: validadoPor,
          contrato: {
            numero_contrato: form.numero_contrato,
            objeto: form.objeto,
            tipo_contrato: form.tipo_contrato || null,
            valor_contrato: numberOrNull(form.valor_contrato),
            base_calculo_amparos: numberOrNull(form.base_calculo_amparos),
            base_calculo_incluye_iva: booleanOrNullFromChoice(
              form.base_calculo_incluye_iva,
            ),
            moneda: form.moneda,
            fecha_inicio: form.fecha_inicio,
            fecha_fin: form.fecha_fin,
            plazo: buildPersistedPlazo(form),
            renovable_automaticamente: form.renovable_automaticamente === "si",
            contratante: form.contratante,
            contratante_nit: form.contratante_nit,
            contratista: form.contratista,
            contratista_nit: form.contratista_nit,
          },
          amparos: amparos.map((amparo) => {
            const calculation = calculateEditableAmparo(amparo, form);
            const motivoRevision = mergeReviewReasons(
              amparo.motivo_revision,
              calculation.motivo_revision,
            );

            return {
              id: amparo.id,
              tipo_amparo: amparo.tipo_amparo,
              porcentaje: calculation.porcentaje,
              cuantia_fija: calculation.cuantia_fija,
              valor_base_calculo: calculation.valor_base_calculo,
              modo_calculo: calculation.modo_calculo,
              valor_asegurado: calculation.valor_asegurado,
              tasa: calculation.tasa,
              dias_vigencia: calculation.dias_vigencia,
              iva_porcentaje: calculation.iva_porcentaje,
              prima_neta: calculation.prima_neta,
              prima_neta_automatica: calculation.prima_neta_automatica,
              prima_neta_manual: calculation.prima_neta_manual,
              usar_prima_neta_manual: calculation.usar_prima_neta_manual,
              impuesto: calculation.impuesto,
              prima_total: calculation.prima_total,
              tasa_manual: amparo.tasa_manual,
              tipo_vigencia: amparo.tipo_vigencia || null,
              base_vigencia: amparo.base_vigencia || null,
              fecha_desde: amparo.fecha_desde_manual
                ? normalizeDateValue(amparo.fecha_desde)
                : null,
              fecha_desde_manual: amparo.fecha_desde_manual,
              fecha_hasta: amparo.fecha_hasta_manual
                ? normalizeDateValue(amparo.fecha_hasta)
                : null,
              fecha_hasta_manual: amparo.fecha_hasta_manual,
              dias_adicionales: calculation.dias_adicionales,
              periodo_adicional_cantidad: calculation.periodo_adicional_cantidad,
              periodo_adicional_unidad: calculation.periodo_adicional_unidad,
              fuente_pagina: integerOrNull(amparo.fuente_pagina),
              fuente_texto: amparo.fuente_texto || null,
              subamparos: calculation.subamparos,
              confianza: amparo.confianza || null,
              requiere_revision: Boolean(motivoRevision),
              motivo_revision: motivoRevision || null,
            };
          }),
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error ?? "No se pudo validar el contrato.");
      }

      setSuccess("Contrato validado correctamente.");
      await reloadDetail(false);
    } catch (saveError) {
      setValidationError(
        saveError instanceof Error
          ? saveError.message
          : "Ocurrió un error inesperado.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function runQuoteAction(
    action: string,
    request: () => Promise<Response>,
    successMessage: string,
  ) {
    setQuoteAction(action);
    setError(null);
    setSuccess(null);

    try {
      const response = await request();
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error ?? "No se pudo completar la acción.");
      }

      setSuccess(successMessage);
      await loadDetail();
    } catch (quoteError) {
      setError(
        quoteError instanceof Error
          ? quoteError.message
          : "Ocurrió un error inesperado.",
      );
    } finally {
      setQuoteAction(null);
    }
  }

  async function onGenerateQuote() {
    await runQuoteAction(
      "generate",
      () =>
        fetch(`/api/contracts/${contractId}/quotes`, {
          method: "POST",
        }),
      "Cotización generada correctamente.",
    );
  }

  async function onDeleteQuote(quoteId: string | number) {
    const confirmed = window.confirm(
      "Esta acción eliminará definitivamente la cotización y su PDF. No se puede deshacer.",
    );

    if (!confirmed) {
      return;
    }

    await runQuoteAction(
      `delete:${quoteId}`,
      () =>
        fetch(`/api/quotes/${quoteId}`, {
          method: "DELETE",
        }),
      "Cotización eliminada correctamente.",
    );
  }

  async function onEmitQuote(quoteId: string | number) {
    await runQuoteAction(
      `emit:${quoteId}`,
      () =>
        fetch(`/api/quotes/${quoteId}/emit`, {
          method: "POST",
        }),
      "Póliza base emitida correctamente.",
    );
  }

  async function onRevertQuote(quoteId: string | number) {
    const reason = window.prompt(
      "Motivo de reversión o anulación",
      "Reversión operativa de emisión",
    );

    if (reason === null) {
      return;
    }

    await runQuoteAction(
      `revert:${quoteId}`,
      () =>
        fetch(`/api/quotes/${quoteId}/revert`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ motivo: reason }),
        }),
      "Emisión revertida correctamente.",
    );
  }

  async function onRenewQuote(fechaInicio: string, fechaFin: string) {
    await runQuoteAction(
      "renew",
      () =>
        fetch(`/api/contracts/${contractId}/renewal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fecha_inicio: fechaInicio,
            fecha_fin: fechaFin,
          }),
        }),
      "Cotización de prórroga generada correctamente.",
    );
  }

  async function onDeleteContract() {
    const confirmation = window.prompt(
      "Esta acción elimina permanentemente el contrato no emitido, sus documentos, cotizaciones de prueba y otrosíes no emitidos. Escribe ELIMINAR para continuar.",
    );

    if (confirmation === null) {
      return;
    }

    if (confirmation !== "ELIMINAR") {
      setError("Confirmación incorrecta. El contrato no fue eliminado.");
      return;
    }

    setIsDeleting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/contracts/${contractId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmacion: confirmation }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error ?? "No se pudo eliminar el contrato.");
      }

      if (Array.isArray(body.storageWarnings) && body.storageWarnings.length > 0) {
        window.alert(
          `El contrato fue eliminado, pero quedaron archivos por limpiar en Storage:\n${body.storageWarnings.join("\n")}`,
        );
      }

      router.push("/contratos");
      router.refresh();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "No se pudo eliminar el contrato.",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-neutral-500 shadow-[var(--shadow-soft)]">
        <Loader2 className="h-4 w-4 animate-ai-spin text-[#d25b30]" aria-hidden />
        Cargando contrato...
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">
        {error ?? "No se pudo cargar el contrato."}
      </div>
    );
  }

  const quotes = detail.cotizaciones ?? [];
  const activeIssuedQuote =
    quotes.find((quote) => quote.estado === "emitida") ?? null;
  const isIssuedLocked = Boolean(activeIssuedQuote);
  const hasIssuedHistory =
    quotes.some(
      (quote) =>
        quote.fecha_emision !== null ||
        ["emitida", "emision_revertida"].includes(quote.estado),
    ) ||
    detail.cotizacionesAjuste.some(
      (quote) =>
        quote.fecha_emision !== null ||
        ["endoso_emitido", "emision_revertida"].includes(quote.estado),
    ) ||
    detail.modificaciones.some(
      (modification) =>
        modification.aplicada_en !== null ||
        ["endoso_emitido", "aplicada"].includes(modification.estado),
    );
  const canGenerateQuote =
    detail.contract.estado === "validado" && !isIssuedLocked && !dirty;
  const amparoViews = amparos.map((amparo, index) => ({
    amparo,
    index,
    calculation: calculateEditableAmparo(amparo, form),
  }));
  const policyGroups = COVERAGE_POLICY_ORDER.map((policy, policyIndex) => {
    const items = amparoViews.filter(
      (view) =>
        (frozenPolicies[view.amparo.uid] ??
          classifyCoveragePolicy(view.calculation.tipo_amparo)) === policy,
    );

    return {
      policy,
      policyIndex,
      items,
      totals: summarizePremiums(items.map((item) => item.calculation)),
    };
  });
  const renewalExpirationAlert = getRenewalExpirationAlert(
    detail.contract,
    detail.amparos,
  );

  function changeActiveTab(tab: ContractDetailTab) {
    setActiveTab(tab);

    if (typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#d25b30]">
            Revisión
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950 sm:text-3xl">
            {detail.client.nombre}
          </h2>
          <p className="mt-2 text-sm text-neutral-500">NIT {detail.client.nit}</p>
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 text-sm text-neutral-600">
            <Metadata
              label="Contrato / orden"
              value={detail.contract.numero_contrato ?? "Sin número"}
            />
            <Metadata
              label="Origen"
              value={
                isManual
                  ? "Nueva cotización · Sin documento"
                  : (documentTypeLabels[baseDocument?.tipo_documento ?? ""] ??
                    "Sin documento")
              }
            />
            <Metadata label="Comercial" value={detail.client.ejecutivo} />
            {!isManual && baseDocument ? (
              <Metadata
                label="Documento"
                value={`${baseDocument.nombre_archivo} · cargado ${formatDate(baseDocument.fecha_carga)}`}
              />
            ) : null}
          </dl>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge state={detail.contract.estado} />
          <details className="relative">
            <summary
              aria-label="Más acciones"
              className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg border border-neutral-200 bg-white text-lg leading-none text-neutral-600 transition hover:bg-neutral-50 [&::-webkit-details-marker]:hidden"
            >
              ⋯
            </summary>
            <div className="absolute right-0 z-30 mt-2 w-56 rounded-lg border border-neutral-200 bg-white p-2 shadow-lg">
              <button
                type="button"
                disabled={hasIssuedHistory || isDeleting}
                onClick={onDeleteContract}
                title={
                  hasIssuedHistory
                    ? "Los contratos con trazabilidad emitida no pueden eliminarse."
                    : "Eliminar contrato no emitido"
                }
                className="h-9 w-full rounded-md px-3 text-left text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-neutral-400 disabled:hover:bg-transparent"
              >
                {isDeleting ? "Eliminando..." : "Eliminar contrato"}
              </button>
            </div>
          </details>
        </div>
      </div>

      {detail.contract.estado === "procesando" || detail.contract.estado === "cargado" ? (
        <AiLoader
          title="Extracción con inteligencia artificial en curso"
          description="Analizando el documento, identificando datos del contrato y amparos. Esta página se actualiza automáticamente cada 3 segundos."
        />
      ) : null}

      {detail.contract.estado === "error" ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">
          {detail.contract.mensaje_error ?? "El procesamiento terminó con error."}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-700">
          {success}
        </div>
      ) : null}

      {renewalExpirationAlert ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800">
          {renewalExpirationAlert}
        </div>
      ) : null}

      {isManual ? null : (
        <DocumentSummary summary={detail.contract.resumen_documento_ia} />
      )}

      <ContractDetailTabs
        activeTab={activeTab}
        onChange={changeActiveTab}
      />

      <section
        id="tab-panel-contrato"
        role="tabpanel"
        aria-labelledby="tab-contrato"
        hidden={activeTab !== "contrato"}
        className="space-y-6"
      >
        {activeIssuedQuote ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800">
            La póliza base emitida bloquea la edición directa de datos, amparos,
            tasas, primas y validación. El historial y el PDF siguen disponibles.
          </div>
        ) : null}

        <form onSubmit={onValidate}>
        <fieldset
          disabled={isIssuedLocked}
          className="space-y-6 disabled:opacity-70"
        >
      <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-neutral-950">
          Datos del contrato
        </h2>
        <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <EditableField
            label="Número"
            value={form.numero_contrato}
            onChange={(value) => updateForm(setForm, "numero_contrato", value)}
            source={ai?.numero_contrato}
          />
          <div className="space-y-2">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-neutral-700">Tipo</span>
              <select
                value={form.tipo_contrato}
                onChange={(event) =>
                  updateForm(setForm, "tipo_contrato", event.target.value)
                }
                className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
              >
                <option value="">Sin dato</option>
                <option value="estatal">Estatal</option>
                <option value="particular">Particular</option>
              </select>
            </label>
            <SourceBlock source={ai?.tipo_contrato} />
          </div>
          <EditableField
            label="Valor del contrato"
            type="text"
            inputMode="decimal"
            value={form.valor_contrato}
            onChange={(value) => updateForm(setForm, "valor_contrato", value)}
            onBlur={(value) =>
              updateForm(setForm, "valor_contrato", formatCurrencyInputValue(value))
            }
            source={ai?.valor_contrato}
          />
          <EditableField
            label="Base de cálculo para amparos"
            type="text"
            inputMode="decimal"
            value={form.base_calculo_amparos}
            onChange={(value) =>
              updateForm(setForm, "base_calculo_amparos", value)
            }
            onBlur={(value) =>
              updateForm(
                setForm,
                "base_calculo_amparos",
                formatCurrencyInputValue(value),
              )
            }
            placeholder="Igual al valor del contrato"
          />
          <EditableField
            label="Fecha inicio"
            value={form.fecha_inicio}
            onChange={(value) => updateForm(setForm, "fecha_inicio", value)}
            source={ai?.fecha_inicio}
            asDate
          />
          <EditableField
            label="Plazo en días"
            type="number"
            value={form.plazo_dias}
            onChange={(value) => updateForm(setForm, "plazo_dias", value)}
          />
          <EditableField
            label="Fecha fin"
            value={form.fecha_fin}
            onChange={(value) => updateForm(setForm, "fecha_fin", value)}
            source={ai?.fecha_fin}
            asDate
          />
        </div>
        <ContractDateStatus form={form} />
        {startDependsOnActaInicio ? (
          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Fecha de inicio depende del Acta de Inicio. No se inventa fecha:
            ingrese fecha de acta/inicio y plazo, o fecha inicio y fecha fin
            manuales. Una fecha válida se usará para recalcular vigencias.
          </div>
        ) : null}
        {form.fecha_fin_manual ? (
          <div className="mt-3 flex flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700 md:flex-row md:items-center md:justify-between">
            <span>
              La fecha fin fue editada manualmente; se respetará ese valor.
            </span>
            <button
              type="button"
              onClick={() =>
                setForm((current) => recalculateContractEndDate(current, true))
              }
              className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-100"
            >
              Recalcular con plazo
            </button>
          </div>
        ) : null}
        <div className="mt-5 space-y-2">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-neutral-700">Objeto</span>
            <textarea
              value={form.objeto}
              onChange={(event) => updateForm(setForm, "objeto", event.target.value)}
              rows={3}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
            />
          </label>
          <SourceBlock source={ai?.objeto} />
        </div>

        <details className="mt-5 rounded-lg border border-neutral-200 bg-neutral-50">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-neutral-800">
            Más detalles
          </summary>
          <div className="grid gap-5 border-t border-neutral-200 p-4 md:grid-cols-2 xl:grid-cols-4">
            <EditableField
              label="Moneda"
              value={form.moneda}
              onChange={(value) => updateForm(setForm, "moneda", value)}
            />
            <div className="space-y-2">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-neutral-700">
                  Base incluye IVA
                </span>
                <select
                  value={form.base_calculo_incluye_iva}
                  onChange={(event) =>
                    updateForm(
                      setForm,
                      "base_calculo_incluye_iva",
                      event.target.value,
                    )
                  }
                  className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
                >
                  <option value="si">Sí</option>
                  <option value="no">No</option>
                  <option value="no_determinado">No determinado</option>
                </select>
              </label>
            </div>
            <EditableField
              label="Plazo (texto del contrato)"
              value={form.plazo}
              onChange={(value) => updateForm(setForm, "plazo", value)}
              source={ai?.plazo}
            />
            <div className="space-y-2">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-neutral-700">
                  Renovable automáticamente
                </span>
                <select
                  value={form.renovable_automaticamente}
                  onChange={(event) =>
                    updateForm(
                      setForm,
                      "renovable_automaticamente",
                      event.target.value,
                    )
                  }
                  className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
                >
                  <option value="no">No</option>
                  <option value="si">Sí</option>
                </select>
              </label>
              <p className="text-xs leading-5 text-neutral-500">
                La revisión manual prevalece sobre cualquier sugerencia del
                documento.
              </p>
            </div>
          </div>
        </details>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-neutral-950">Partes</h2>
        <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <EditableField
            label="Contratante"
            value={form.contratante}
            onChange={(value) => updateForm(setForm, "contratante", value)}
            source={ai?.contratante}
          />
          <EditableField
            label="NIT contratante"
            value={form.contratante_nit}
            onChange={(value) => updateForm(setForm, "contratante_nit", value)}
          />
          <EditableField
            label="Contratista"
            value={form.contratista}
            onChange={(value) => updateForm(setForm, "contratista", value)}
            source={ai?.contratista}
          />
          <EditableField
            label="NIT contratista"
            value={form.contratista_nit}
            onChange={(value) => updateForm(setForm, "contratista_nit", value)}
          />
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-neutral-950">Amparos</h2>
          <button
            type="button"
            onClick={() => setAmparos((items) => [...items, newAmparo()])}
            className="h-10 rounded-lg border border-neutral-300 bg-white px-4 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-50"
          >
            Agregar
          </button>
        </div>

        <div className="mt-5 flex flex-col gap-3">
          {amparos.length === 0 ? (
            <p className="text-sm text-neutral-500">
              {isManual
                ? "Agrega al menos un amparo para poder cotizar."
                : "No se detectaron amparos."}
            </p>
          ) : null}
          {policyGroups
            .filter((group) => group.items.length > 0)
            .flatMap((group) => [
              <PolicyHeader
                key={`policy-${group.policy}`}
                label={COVERAGE_POLICY_LABELS[group.policy]}
                totals={group.totals}
                currency={form.moneda || "COP"}
              />,
              ...group.items.map((view) => (
            <AmparoCard
              key={view.amparo.uid}
              amparo={view.amparo}
              calculation={view.calculation}
              form={form}
              isManual={isManual}
              validated={detail.contract.estado === "validado" && !dirty}
              onEditingChange={setAmparoEditing}
              onChange={(key, value) => updateAmparo(view.index, key, value)}
              onDateOverride={(manualKey, valueKey, checked, calculatedValue) =>
                updateAmparoDateOverride(
                  view.index,
                  manualKey,
                  valueKey,
                  checked,
                  calculatedValue,
                )
              }
              onRemove={() =>
                setAmparos((items) =>
                  items.filter((item) => item.uid !== view.amparo.uid),
                )
              }
            />
              )),
            ])}
        </div>
      </section>

      <div className="sticky bottom-0 z-20 rounded-lg border border-neutral-200 bg-white/95 p-4 shadow-[0_-6px_20px_rgba(0,0,0,0.07)] backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
            Validado por
            <select
              value={validadoPor}
              onChange={(event) => setValidadoPor(event.target.value)}
              className="h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
            >
              {EXECUTIVES.map((executive) => (
                <option key={executive} value={executive}>
                  {executive}
                </option>
              ))}
            </select>
          </label>
          <div
            className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm"
            aria-live="polite"
          >
            {dirty ? (
              <ReviewChip tone="review">Cambios sin validar</ReviewChip>
            ) : detail.contract.estado === "validado" ? (
              <ReviewChip tone="ok">Validado</ReviewChip>
            ) : null}
            {validationError ? (
              <span className="font-medium text-rose-700">{validationError}</span>
            ) : null}
          </div>
          {isIssuedLocked ? (
            <button
              type="submit"
              disabled
              className="h-11 rounded-lg bg-[#d25b30] px-5 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:bg-neutral-400"
            >
              Póliza emitida
            </button>
          ) : canGenerateQuote ? (
            <button
              type="button"
              onClick={onGenerateQuote}
              disabled={quoteAction !== null}
              className="h-11 rounded-lg bg-[#d25b30] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#b94d28] disabled:cursor-not-allowed disabled:bg-neutral-400"
            >
              {quoteAction === "generate" ? "Generando..." : "Generar cotización"}
            </button>
          ) : (
            <>
              {detail.contract.estado === "validado" ? (
                <button
                  type="button"
                  disabled
                  title="Confirma la validación de los cambios para generar la cotización."
                  className="h-11 rounded-lg border border-neutral-300 bg-white px-5 text-sm font-semibold text-neutral-400 disabled:cursor-not-allowed"
                >
                  Generar cotización
                </button>
              ) : null}
              <button
                type="submit"
                disabled={isSaving || detail.contract.estado === "procesando"}
                className="h-11 rounded-lg bg-[#d25b30] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#b94d28] disabled:cursor-not-allowed disabled:bg-neutral-400"
              >
                {isSaving ? "Guardando..." : "Confirmar validación"}
              </button>
            </>
          )}
        </div>
      </div>
        </fieldset>
        </form>
      </section>

      <section
        id="tab-panel-cotizaciones"
        role="tabpanel"
        aria-labelledby="tab-cotizaciones"
        hidden={activeTab !== "cotizaciones"}
      >
        <QuotePanel
          contract={detail.contract}
          quotes={quotes}
          activeIssuedQuote={activeIssuedQuote}
          quoteAction={quoteAction}
          onEmitQuote={onEmitQuote}
          onRevertQuote={onRevertQuote}
          onRenewQuote={onRenewQuote}
          onDeleteQuote={onDeleteQuote}
        />
      </section>

      <section
        id="tab-panel-otrosies"
        role="tabpanel"
        aria-labelledby="tab-otrosies"
        hidden={activeTab !== "otrosies"}
      >
        {activeIssuedQuote ? (
          <AmendmentsPanel
            baseQuote={activeIssuedQuote}
            contract={detail.contract}
            baseAmparos={detail.amparos}
            modificaciones={detail.modificaciones ?? []}
            cotizacionesAjuste={detail.cotizacionesAjuste ?? []}
            onChanged={loadDetail}
          />
        ) : (
          <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-6 text-sm text-neutral-600 shadow-sm">
            Para cargar y liquidar otrosíes primero debe existir una póliza base
            emitida activa.
          </div>
        )}
      </section>
    </div>
  );

  function updateAmparo(
    index: number,
    key: keyof EditableAmparo,
    value: string | boolean | CoverageSubamparo[],
  ) {
    setAmparos((items) =>
      items.map((item, itemIndex) => {
        if (itemIndex !== index) {
          return item;
        }

        const next: EditableAmparo = {
          ...item,
          [key]: value,
          tasa_manual: key === "tasa" ? true : item.tasa_manual,
        } as EditableAmparo;

        if (key === "porcentaje" && typeof value === "string" && value.trim()) {
          next.modo_calculo = "porcentaje_valor_contrato";
          next.cuantia_fija = "";
          next.valor_asegurado = "";
        }

        if (key === "cuantia_fija" && typeof value === "string" && value.trim()) {
          next.modo_calculo = "cuantia_fija";
          next.porcentaje = "";
          next.valor_asegurado = "";
        }

        if (key === "valor_asegurado" && typeof value === "string" && value.trim()) {
          next.modo_calculo = "valor_asegurado_manual";
          next.porcentaje = "";
          next.cuantia_fija = "";
        }

        if (key === "modo_calculo" && typeof value === "string") {
          if (value === "porcentaje_valor_contrato") {
            next.cuantia_fija = "";
            next.valor_asegurado = "";
          } else if (value === "cuantia_fija") {
            next.porcentaje = "";
            next.valor_asegurado = "";
          } else if (value === "valor_asegurado_manual") {
            next.porcentaje = "";
            next.cuantia_fija = "";
          }
        }

        return next;
      }),
    );
  }

  function updateAmparoDateOverride(
    index: number,
    flagKey: "fecha_desde_manual" | "fecha_hasta_manual",
    dateKey: "fecha_desde" | "fecha_hasta",
    checked: boolean,
    calculatedDate: string | null,
  ) {
    setAmparos((items) =>
      items.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [flagKey]: checked,
              [dateKey]: checked ? calculatedDate ?? "" : "",
            }
          : item,
      ),
    );
  }
}

function ContractDetailTabs({
  activeTab,
  onChange,
}: {
  activeTab: ContractDetailTab;
  onChange: (tab: ContractDetailTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Secciones del contrato"
      className="grid gap-2 rounded-lg border border-neutral-200 bg-white p-2 shadow-sm sm:grid-cols-3"
    >
      {CONTRACT_DETAIL_TABS.map((tab) => {
        const isActive = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`tab-panel-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
                return;
              }

              event.preventDefault();
              const currentIndex = CONTRACT_DETAIL_TABS.findIndex(
                (item) => item.id === activeTab,
              );
              const offset = event.key === "ArrowRight" ? 1 : -1;
              const nextIndex =
                (currentIndex + offset + CONTRACT_DETAIL_TABS.length) %
                CONTRACT_DETAIL_TABS.length;
              onChange(CONTRACT_DETAIL_TABS[nextIndex].id);
            }}
            className={[
              "h-10 rounded-md px-3 text-sm font-semibold outline-none transition focus-visible:ring-4 focus-visible:ring-[#d25b30]/20",
              isActive
                ? "bg-[#d25b30] text-white shadow-sm"
                : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950",
            ].join(" ")}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function DocumentSummary({ summary }: { summary: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const text =
    summary?.trim() ||
    "Este contrato fue procesado antes de incorporar el resumen contextual. No se reprocesa automáticamente para conservar la trazabilidad.";
  const isLong = text.length > 180;

  return (
    <section className="rounded-lg border border-neutral-200 bg-white px-5 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-neutral-900">
          Resumen del documento
        </h2>
        <span className="rounded-full bg-[#d25b30]/10 px-2 py-0.5 text-xs font-semibold text-[#b94d28]">
          Generado por IA
        </span>
        {isLong ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="ml-auto text-xs font-semibold text-[#b94d28] underline-offset-2 hover:underline"
          >
            {expanded ? "Ver menos" : "Ver más"}
          </button>
        ) : null}
      </div>
      <p
        className={`mt-2 text-sm leading-6 text-neutral-700 ${expanded || !isLong ? "" : "line-clamp-2"}`}
      >
        {text}
      </p>
    </section>
  );
}

function QuotePanel({
  contract,
  quotes,
  activeIssuedQuote,
  quoteAction,
  onEmitQuote,
  onRevertQuote,
  onRenewQuote,
  onDeleteQuote,
}: {
  contract: Contrato;
  quotes: Cotizacion[];
  activeIssuedQuote: Cotizacion | null;
  quoteAction: string | null;
  onEmitQuote: (quoteId: string | number) => void;
  onRevertQuote: (quoteId: string | number) => void;
  onRenewQuote: (fechaInicio: string, fechaFin: string) => void;
  onDeleteQuote: (quoteId: string | number) => void;
}) {
  const activeSnapshot = activeIssuedQuote
    ? getQuoteSnapshot(activeIssuedQuote)
    : null;
  const referenceQuote = activeIssuedQuote ?? quotes[0] ?? null;
  const referenceSnapshot = referenceQuote
    ? getQuoteSnapshot(referenceQuote)
    : null;
  const [isRenewing, setIsRenewing] = useState(false);
  const [renewalStart, setRenewalStart] = useState(
    activeSnapshot?.contrato.fecha_fin
      ? addDaysToDate(activeSnapshot.contrato.fecha_fin, 1)
      : "",
  );
  const [renewalEnd, setRenewalEnd] = useState("");
  const canRenew = Boolean(activeIssuedQuote && contract.renovable_automaticamente);

  function openRenewalForm() {
    setRenewalStart(
      activeSnapshot?.contrato.fecha_fin
        ? addDaysToDate(activeSnapshot.contrato.fecha_fin, 1)
        : "",
    );
    setRenewalEnd("");
    setIsRenewing(true);
  }

  function submitRenewal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!normalizeDateValue(renewalStart) || !normalizeDateValue(renewalEnd)) {
      return;
    }

    onRenewQuote(renewalStart, renewalEnd);
  }

  return (
    <section className="rounded-lg border border-[#d25b30]/20 bg-white p-6 shadow-sm">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#d25b30]">
            AFISEC
          </p>
          <h2 className="mt-2 text-lg font-semibold text-neutral-950">
            Cotizaciones y emisión
          </h2>
          <p className="mt-2 text-sm text-neutral-500">
            Historial versionado y póliza base emitida.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canRenew ? (
            <button
              type="button"
              onClick={openRenewalForm}
              disabled={quoteAction !== null}
              className="h-11 rounded-lg border border-[#d25b30] bg-white px-4 text-sm font-semibold text-[#b94d28] shadow-sm transition hover:bg-[#d25b30]/5 disabled:cursor-not-allowed disabled:border-neutral-300 disabled:text-neutral-400"
            >
              Prorrogar
            </button>
          ) : null}
        </div>
      </div>

      {isRenewing ? (
        <form
          onSubmit={submitRenewal}
          className="mt-5 grid gap-4 rounded-lg border border-[#d25b30]/20 bg-[#d25b30]/5 p-4 md:grid-cols-[1fr_1fr_auto_auto]"
        >
          <label className="space-y-2">
            <span className="text-sm font-medium text-neutral-700">
              Nueva vigencia desde
            </span>
            <input
              type="date"
              autoComplete="off"
              value={renewalStart}
              onChange={(event) => setRenewalStart(event.target.value)}
              className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-neutral-700">
              Nueva vigencia hasta
            </span>
            <input
              type="date"
              autoComplete="off"
              value={renewalEnd}
              onChange={(event) => setRenewalEnd(event.target.value)}
              className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
            />
          </label>
          <button
            type="submit"
            disabled={
              quoteAction !== null ||
              !normalizeDateValue(renewalStart) ||
              !normalizeDateValue(renewalEnd)
            }
            className="h-10 self-end rounded-lg bg-[#d25b30] px-4 text-sm font-semibold text-white transition hover:bg-[#b94d28] disabled:cursor-not-allowed disabled:bg-neutral-400"
          >
            {quoteAction === "renew" ? "Generando..." : "Generar prórroga"}
          </button>
          <button
            type="button"
            onClick={() => setIsRenewing(false)}
            disabled={quoteAction !== null}
            className="h-10 self-end rounded-lg border border-neutral-300 bg-white px-4 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:text-neutral-400"
          >
            Cancelar
          </button>
        </form>
      ) : null}

      {activeIssuedQuote ? (
        <IssuedPolicySummary quote={activeIssuedQuote} snapshot={activeSnapshot} />
      ) : null}

      <QuotesHistoryTable
        quotes={quotes}
        activeIssuedQuote={activeIssuedQuote}
        quoteAction={quoteAction}
        onEmitQuote={onEmitQuote}
        onRevertQuote={onRevertQuote}
        onDeleteQuote={onDeleteQuote}
      />

      {referenceQuote && referenceSnapshot ? (
        <QuoteCoverageTable
          quote={referenceQuote}
          snapshot={referenceSnapshot}
          title={
            activeIssuedQuote
              ? "Amparos de la póliza emitida"
              : "Amparos de la última cotización"
          }
        />
      ) : null}
    </section>
  );
}

function QuotesHistoryTable({
  quotes,
  activeIssuedQuote,
  quoteAction,
  onEmitQuote,
  onRevertQuote,
  onDeleteQuote,
}: {
  quotes: Cotizacion[];
  activeIssuedQuote: Cotizacion | null;
  quoteAction: string | null;
  onEmitQuote: (quoteId: string | number) => void;
  onRevertQuote: (quoteId: string | number) => void;
  onDeleteQuote: (quoteId: string | number) => void;
}) {
  if (quotes.length === 0) {
    return (
      <p className="mt-5 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-500">
        Aún no hay cotizaciones generadas para este contrato.
      </p>
    );
  }

  return (
    <div className="mt-5 overflow-x-auto rounded-lg border border-neutral-200">
      <table className="min-w-[860px] w-full border-collapse text-left text-sm">
        <thead className="bg-neutral-50 text-xs font-semibold uppercase tracking-[0.08em] text-neutral-500">
          <tr>
            <th className="border-b border-neutral-200 px-3 py-2">Cotización</th>
            <th className="border-b border-neutral-200 px-3 py-2">Versión</th>
            <th className="border-b border-neutral-200 px-3 py-2">Estado</th>
            <th className="border-b border-neutral-200 px-3 py-2">Generada</th>
            <th className="border-b border-neutral-200 px-3 py-2">Emitida</th>
            <th className="border-b border-neutral-200 px-3 py-2 text-right">Prima por póliza</th>
            <th className="border-b border-neutral-200 px-3 py-2 text-right">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100 bg-white">
          {quotes.map((quote) => {
            const snapshot = getQuoteSnapshot(quote);
            const currency = snapshot?.contrato.moneda ?? "COP";

            return (
              <tr key={quote.id}>
                <td className="px-3 py-3 font-semibold text-neutral-950">
                  {quote.numero_cotizacion}
                </td>
                <td className="px-3 py-3 text-neutral-700">v{quote.version}</td>
                <td className="px-3 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${quoteStatusClass(quote.estado)}`}
                  >
                    {quoteStatusLabel(quote.estado)}
                  </span>
                </td>
                <td className="px-3 py-3 text-neutral-700">
                  {formatDate(quote.fecha_generacion)}
                </td>
                <td className="px-3 py-3 text-neutral-700">
                  {quote.fecha_emision
                    ? formatDate(quote.fecha_emision)
                    : quote.fecha_reversion
                      ? `Revertida ${formatDate(quote.fecha_reversion)}`
                      : "Sin emitir"}
                </td>
                <td className="px-3 py-3 text-right font-semibold text-neutral-950">
                  {formatPolicyTotals(snapshot, currency).map((total) => (
                    <div key={total.key}>
                      <span className="mr-2 text-xs font-medium text-neutral-500">
                        {total.label}
                      </span>
                      {total.value}
                    </div>
                  ))}
                </td>
                <td className="px-3 py-3">
                  <div className="flex justify-end gap-2">
                    <PdfPreviewDialog
                      url={`/api/quotes/${quote.id}/download`}
                      fileName={`cotizacion-afisec-v${quote.version}.pdf`}
                      label="PDF"
                    />
                    {quote.estado === "generada" ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onEmitQuote(quote.id)}
                          disabled={activeIssuedQuote !== null || quoteAction !== null}
                          className="h-9 rounded-lg bg-neutral-950 px-3 text-xs font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
                        >
                          {activeIssuedQuote
                            ? "Emisión activa"
                            : quoteAction === `emit:${quote.id}`
                              ? "Emitiendo"
                              : "Emitir"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteQuote(quote.id)}
                          disabled={quoteAction !== null}
                          className="h-9 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-neutral-400"
                        >
                          {quoteAction === `delete:${quote.id}`
                            ? "Eliminando"
                            : "Eliminar"}
                        </button>
                      </>
                    ) : null}
                    {quote.estado === "emitida" ? (
                      <button
                        type="button"
                        onClick={() => onRevertQuote(quote.id)}
                        disabled={quoteAction !== null}
                        className="h-9 rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400"
                      >
                        {quoteAction === `revert:${quote.id}` ? "Revirtiendo" : "Revertir"}
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function IssuedPolicySummary({
  quote,
  snapshot,
}: {
  quote: Cotizacion;
  snapshot: QuoteSnapshot | null;
}) {
  const currency = snapshot?.contrato.moneda ?? "COP";
  const rceSubcoverages = snapshot ? getCivilLiabilitySubcoverages(snapshot) : [];

  return (
    <div className="mt-5 overflow-x-auto rounded-lg border border-emerald-200 bg-emerald-50">
      <table className="min-w-[760px] w-full border-collapse text-left text-sm">
        <caption className="bg-emerald-50 px-3 py-2 text-left text-sm font-semibold text-emerald-900">
          Póliza base emitida
        </caption>
        <tbody className="bg-white">
          <tr>
            <TableLabel>Cotización</TableLabel>
            <TableValue>{quote.numero_cotizacion}</TableValue>
            <TableLabel>Versión</TableLabel>
            <TableValue>v{quote.version}</TableValue>
            <TableLabel>Fecha emisión</TableLabel>
            <TableValue>{formatDate(quote.fecha_emision)}</TableValue>
          </tr>
          <tr>
            <TableLabel>Cliente</TableLabel>
            <TableValue>{snapshot?.cliente.nombre ?? "Sin dato"}</TableValue>
            <TableLabel>Contrato / orden</TableLabel>
            <TableValue>
              {snapshot?.contrato.numero_contrato ?? "Sin número"}
            </TableValue>
            <TableLabel>Prima por póliza</TableLabel>
            <TableValue>
              {snapshot ? (
                formatPolicyTotals(snapshot, currency).map((total) => (
                  <div key={total.key}>
                    {total.label}: {total.value}
                  </div>
                ))
              ) : (
                formatCurrency(quote.total_prima, currency)
              )}
            </TableValue>
          </tr>
          <tr>
            <TableLabel>Contratante</TableLabel>
            <TableValue>
              {snapshot?.contrato.contratante ?? "Sin dato"}
            </TableValue>
            <TableLabel>Contratista</TableLabel>
            <TableValue>
              {snapshot?.contrato.contratista ?? "Sin dato"}
            </TableValue>
            <TableLabel>Amparos</TableLabel>
            <TableValue>{String(snapshot?.amparos.length ?? 0)}</TableValue>
          </tr>
          {rceSubcoverages.length > 0 ? (
            <tr>
              <TableLabel>Subamparos RCE</TableLabel>
              <td
                colSpan={5}
                className="border border-emerald-100 px-3 py-2 text-neutral-800"
              >
                {formatSubcoveragesForUi(rceSubcoverages, currency)}
                <span className="ml-2 text-neutral-500">
                  Sin prima individual; la prima corresponde a la línea principal
                  RCE/PLO.
                </span>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function QuoteCoverageTable({
  quote,
  snapshot,
  title,
}: {
  quote: Cotizacion;
  snapshot: QuoteSnapshot;
  title: string;
}) {
  const currency = snapshot.contrato.moneda;
  const groups = groupQuoteCoveragesByPolicy(snapshot.amparos);

  return (
    <div className="mt-5 space-y-4">
      <p className="text-sm font-semibold text-neutral-950">
        {title}: {quote.numero_cotizacion} v{quote.version}
      </p>
      {groups.length === 0 ? (
        <p className="rounded-lg border border-neutral-200 px-3 py-4 text-sm text-neutral-500">
          No hay amparos cotizados.
        </p>
      ) : (
        groups.map((group) => (
          <PolicyCoverageTable
            key={group.poliza}
            group={group}
            currency={currency}
          />
        ))
      )}
    </div>
  );
}

function PolicyCoverageTable({
  group,
  currency,
}: {
  group: QuotePolicyGroup;
  currency: string;
}) {
  const subcoverages = group.amparos.flatMap((amparo) =>
    getIncludedSubcoverages(amparo.subamparos),
  );
  const totalLabel = `Total ${group.nombre.charAt(0).toLowerCase()}${group.nombre.slice(1)}`;

  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200">
      <table className="min-w-[980px] w-full border-collapse text-left text-sm">
        <caption className="bg-neutral-50 px-3 py-2 text-left text-sm font-semibold uppercase tracking-[0.06em] text-neutral-950">
          {group.nombre}
        </caption>
        <thead className="bg-neutral-50 text-xs font-semibold uppercase tracking-[0.08em] text-neutral-500">
          <tr>
            <th className="border-y border-neutral-200 px-3 py-2">Amparo</th>
            <th className="border-y border-neutral-200 px-3 py-2 text-right">Valor asegurado</th>
            <th className="border-y border-neutral-200 px-3 py-2">Desde</th>
            <th className="border-y border-neutral-200 px-3 py-2">Hasta</th>
            <th className="border-y border-neutral-200 px-3 py-2 text-right">Días</th>
            <th className="border-y border-neutral-200 px-3 py-2 text-right">Prima neta</th>
            <th className="border-y border-neutral-200 px-3 py-2 text-right">IVA</th>
            <th className="border-y border-neutral-200 px-3 py-2 text-right">Prima total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100 bg-white">
          {group.amparos.map((amparo, index) => (
            <tr key={`${amparo.tipo_amparo}-${index}`}>
              <td className="px-3 py-3 font-medium text-neutral-950">
                {formatCoverageName(amparo.tipo_amparo)}
              </td>
              <td className="px-3 py-3 text-right">
                {formatCurrency(amparo.valor_asegurado, currency)}
              </td>
              <td className="px-3 py-3">{formatDate(amparo.fecha_desde)}</td>
              <td className="px-3 py-3">{formatDate(amparo.fecha_hasta)}</td>
              <td className="px-3 py-3 text-right">
                {amparo.dias_vigencia ?? "Sin dato"}
              </td>
              <td className="px-3 py-3 text-right">
                {formatCurrency(amparo.prima_neta, currency)}
              </td>
              <td className="px-3 py-3 text-right">
                {formatCurrency(amparo.iva, currency)}
              </td>
              <td className="px-3 py-3 text-right font-semibold text-neutral-950">
                {formatCurrency(amparo.prima_total, currency)}
              </td>
            </tr>
          ))}
          {subcoverages.length > 0 ? (
            <tr className="bg-neutral-50">
              <td colSpan={8} className="px-3 py-2 text-xs leading-5 text-neutral-600">
                <span className="font-semibold text-neutral-800">
                  Subamparos incluidos:
                </span>
                <ul className="mt-1 space-y-0.5 pl-4">
                  {subcoverages.map((subamparo) => (
                    <li key={subamparo.nombre}>
                      {subamparo.nombre}
                      {subamparo.valor_sublimite === null
                        ? ""
                        : ` (${formatCurrency(subamparo.valor_sublimite, currency)})`}
                      {subamparo.calculable ? " · línea principal" : " · sin prima individual"}
                    </li>
                  ))}
                </ul>
                <span className="mt-1 block">
                  La prima de esta póliza corresponde a la línea principal RCE/PLO.
                </span>
              </td>
            </tr>
          ) : null}
        </tbody>
        <tfoot className="bg-neutral-50 text-sm font-semibold text-neutral-950">
          <tr>
            <td colSpan={5} className="border-t border-neutral-200 px-3 py-2 text-right">
              {totalLabel}
            </td>
            <td className="border-t border-neutral-200 px-3 py-2 text-right">
              {formatCurrency(group.totales.prima_neta, currency)}
            </td>
            <td className="border-t border-neutral-200 px-3 py-2 text-right">
              {formatCurrency(group.totales.iva, currency)}
            </td>
            <td className="border-t border-neutral-200 px-3 py-2 text-right text-[#d25b30]">
              {formatCurrency(group.totales.prima_total, currency)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function getCivilLiabilitySubcoverages(snapshot: QuoteSnapshot) {
  return snapshot.amparos.flatMap((amparo) =>
    getCoveragePolicy(amparo) === "responsabilidad_civil"
      ? getIncludedSubcoverages(amparo.subamparos)
      : [],
  );
}

function getIncludedSubcoverages(
  subcoverages: QuoteSnapshotSubcoverage[] | undefined,
) {
  return Array.isArray(subcoverages)
    ? subcoverages.filter((subcoverage) => subcoverage.incluido)
    : [];
}

function formatPolicyTotals(snapshot: QuoteSnapshot | null, currency: string) {
  return groupQuoteCoveragesByPolicy(snapshot?.amparos ?? []).map((group) => ({
    key: group.poliza,
    label:
      group.poliza === "responsabilidad_civil" ? "Resp. civil" : "Cumplimiento",
    value: formatCurrency(group.totales.prima_total, currency),
  }));
}

function formatSubcoveragesForUi(

  subcoverages: QuoteSnapshotSubcoverage[],
  currency: string,
) {
  return subcoverages
    .map((subcoverage) => {
      const sublimit =
        subcoverage.valor_sublimite === null
          ? ""
          : ` (${formatCurrency(subcoverage.valor_sublimite, currency)})`;

      return `${subcoverage.nombre}${sublimit}`;
    })
    .join("; ");
}

function TableLabel({ children }: { children: ReactNode }) {
  return (
    <th className="border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-emerald-800">
      {children}
    </th>
  );
}

function TableValue({ children }: { children: ReactNode }) {
  return (
    <td className="border border-emerald-100 px-3 py-2 font-semibold text-neutral-950">
      {children}
    </td>
  );
}

function quoteStatusClass(status: string) {
  if (status === "emitida") {
    return "bg-emerald-100 text-emerald-800";
  }

  if (status === "emision_revertida" || status === "anulada") {
    return "bg-amber-100 text-amber-800";
  }

  return "bg-sky-100 text-sky-800";
}

function EditableField({
  label,
  value,
  onChange,
  onBlur,
  source,
  type = "text",
  inputMode,
  asDate = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: (value: string) => void;
  source?: SourceMeta;
  type?: "text" | "number" | "date";
  inputMode?: "decimal" | "numeric";
  asDate?: boolean;
  placeholder?: string;
}) {
  if (asDate) {
    return (
      <DateTextField
        label={label}
        value={value}
        onChange={onChange}
        source={source}
      />
    );
  }

  return (
    <div className="space-y-2">
      <label className="block space-y-2">
        <span className="text-sm font-medium text-neutral-700">{label}</span>
        <input
          type={type}
          step={type === "number" ? "any" : undefined}
          inputMode={inputMode}
          autoComplete={type === "date" ? "off" : undefined}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => onBlur?.(event.target.value)}
          className="h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
        />
      </label>
      <SourceBlock source={source} />
    </div>
  );
}

function DateTextField({
  label,
  value,
  onChange,
  source,
  warning,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  source?: SourceMeta;
  warning?: string | null;
}) {
  return (
    <div className="space-y-2">
      <label className="block space-y-2">
        <span className="text-sm font-medium text-neutral-700">{label}</span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="DD/MM/YYYY"
          value={formatDateInputValue(value)}
          onChange={(event) => onChange(normalizeDateInputChange(event.target.value))}
          className="h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
        />
        {warning ? (
          <span className="block text-xs font-medium leading-5 text-amber-700">
            {warning}
          </span>
        ) : (
          <span className="block text-xs leading-5 text-neutral-500">
            Formato DD/MM/YYYY. El cálculo se actualiza solo con fecha completa.
          </span>
        )}
      </label>
      <SourceBlock source={source} />
    </div>
  );
}

function EditableAmparoField({
  label,
  value,
  onChange,
  onBlur,
  type = "text",
  inputMode,
  help,
  warning,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: (value: string) => void;
  type?: "text" | "number" | "date";
  inputMode?: "decimal" | "numeric";
  help?: string;
  warning?: string | null;
  disabled?: boolean;
}) {
  return (
    <label className={`space-y-2 ${disabled ? "opacity-60" : ""}`}>
      <span className="text-sm font-medium text-neutral-700">{label}</span>
      <input
        type={type}
        step={type === "number" ? "any" : undefined}
        inputMode={inputMode}
        autoComplete={type === "date" ? "off" : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => onBlur?.(event.target.value)}
        disabled={disabled}
        className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15 disabled:cursor-not-allowed disabled:bg-neutral-100"
      />
      {warning ? (
        <span className="block text-xs font-medium leading-5 text-amber-700">
          {warning}
        </span>
      ) : help ? (
        <span className="block text-xs leading-5 text-neutral-500">
          {help}
        </span>
      ) : null}
    </label>
  );
}

function ContractDateStatus({ form }: { form: ContractForm }) {
  const issues = getContractDateIssues(form);

  if (issues.length > 0) {
    return (
      <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800">
        {issues.join(" ")}
      </div>
    );
  }

  return null;
}

function ManualDateOverride({
  checkboxLabel,
  fieldLabel,
  checked,
  value,
  onCheckedChange,
  onValueChange,
  warning,
}: {
  checkboxLabel: string;
  fieldLabel: string;
  checked: boolean;
  value: string;
  onCheckedChange: (checked: boolean) => void;
  onValueChange: (value: string) => void;
  warning?: string | null;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <label className="inline-flex items-center gap-2 text-sm font-medium text-neutral-700">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onCheckedChange(event.target.checked)}
          className="h-4 w-4 rounded border-neutral-300 text-[#d25b30] focus:ring-[#d25b30]"
        />
        {checkboxLabel}
      </label>
      {checked ? (
        <div className="mt-3">
          <DateTextField
            label={fieldLabel}
            value={value}
            onChange={onValueChange}
            warning={warning}
          />
        </div>
      ) : null}
    </div>
  );
}

function SubcoverageEditor({
  subamparos,
  currency,
  mainInsuredValue,
  validated,
  onChange,
}: {
  subamparos: CoverageSubamparo[];
  currency: string;
  mainInsuredValue: number | null;
  validated: boolean;
  onChange: (subamparos: CoverageSubamparo[]) => void;
}) {
  function updateSubamparo(
    index: number,
    patch: Partial<CoverageSubamparo>,
  ) {
    onChange(
      subamparos.map((subamparo, itemIndex) =>
        itemIndex === index ? { ...subamparo, ...patch } : subamparo,
      ),
    );
  }

  const inputClass =
    "h-8 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15";

  return (
    <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SectionTitle>Subamparos incluidos</SectionTitle>
        <p className="text-xs text-neutral-500">
          Solo la línea calculable alimenta la prima
        </p>
      </div>
      <div className="hidden grid-cols-[1.5rem_1fr_6rem_11rem] gap-3 px-1 text-xs font-medium text-neutral-500 sm:grid">
        <span />
        <span>Subamparo</span>
        <span>% sublímite</span>
        <span>Valor sublímite</span>
      </div>
      <div className="divide-y divide-neutral-100">
        {subamparos.map((subamparo, index) => (
          <div
            key={`${subamparo.nombre}-${index}`}
            className="grid items-center gap-x-3 gap-y-1 px-1 py-1.5 sm:grid-cols-[1.5rem_1fr_6rem_11rem]"
          >
            <input
              type="checkbox"
              aria-label={`Incluir ${subamparo.nombre}`}
              checked={subamparo.incluido}
              onChange={(event) =>
                updateSubamparo(index, { incluido: event.target.checked })
              }
              className="h-4 w-4 rounded border-neutral-300 text-[#d25b30] focus:ring-[#d25b30]"
            />
            <div className="min-w-0 text-sm">
              <span className="font-medium text-neutral-900">{subamparo.nombre}</span>
              <span
                className="ml-2 text-xs text-neutral-500"
                title={
                  subamparo.origen === "contrato"
                    ? "Dato contractual"
                    : "Regla plantilla AFISEC"
                }
              >
                {subamparo.calculable ? "calculable" : "informativo"}
                {subamparo.requiere_revision && !validated ? " · revisar" : ""}
              </span>
            </div>
            {subamparo.calculable ? (
              <span className="text-sm text-neutral-700">
                {percentFromDecimal(subamparo.porcentaje_sublimite)}%
              </span>
            ) : (
              <input
                type="number"
                step="any"
                aria-label={`Porcentaje sublímite de ${subamparo.nombre}`}
                value={percentFromDecimal(subamparo.porcentaje_sublimite)}
                onChange={(event) => {
                  const percentage = decimalFromPercent(event.target.value);
                  updateSubamparo(index, {
                    porcentaje_sublimite: percentage,
                    valor_sublimite:
                      percentage === null || mainInsuredValue === null
                        ? subamparo.valor_sublimite
                        : roundMoney(mainInsuredValue * percentage),
                    origen:
                      subamparo.origen === "contrato"
                        ? "contrato"
                        : "regla_plantilla_afisec",
                  });
                }}
                className={inputClass}
              />
            )}
            {subamparo.calculable ? (
              <span className="text-sm text-neutral-700">
                {subamparo.valor_sublimite === null
                  ? "Sin sublímite"
                  : formatCurrency(subamparo.valor_sublimite, currency)}
              </span>
            ) : (
              <input
                type="text"
                inputMode="decimal"
                aria-label={`Valor sublímite de ${subamparo.nombre}`}
                value={
                  subamparo.valor_sublimite === null
                    ? ""
                    : String(subamparo.valor_sublimite)
                }
                onChange={(event) =>
                  updateSubamparo(index, {
                    valor_sublimite: numberOrNull(event.target.value),
                  })
                }
                className={inputClass}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

type AmparoCalculation = ReturnType<typeof calculateEditableAmparo>;

const INSURED_VALUE_MODES: Array<{ value: string; label: string }> = [
  { value: "porcentaje_valor_contrato", label: "Porcentaje sobre base" },
  { value: "cuantia_fija", label: "Cuantía fija" },
  { value: "valor_asegurado_manual", label: "Valor manual" },
];

const documentTypeLabels: Record<string, string> = {
  contrato_base: "Contrato base",
  orden: "Orden de servicio",
  orden_compra: "Orden de compra",
  otrosi: "Otrosí",
};

let newAmparoSequence = 0;

function getInitialValidator(detail: DetailResponse) {
  const stored = detail.contract.validado_por;

  if (
    detail.contract.estado === "validado" &&
    stored &&
    EXECUTIVES.some((executive) => executive === stored)
  ) {
    return stored;
  }

  const clientExecutive = detail.client.ejecutivo;

  if (EXECUTIVES.some((executive) => executive === clientExecutive)) {
    return clientExecutive;
  }

  return normalizeExecutiveForForm(stored);
}

function describeInsuredValue(calculation: AmparoCalculation, currency: string) {
  const percentage = percentFromDecimal(calculation.porcentaje);
  const base = formatCurrency(getCoverageBaseDisplayValue(calculation), currency);

  if (calculation.modo_calculo === "anticipo_100") {
    return percentage ? `${percentage}% del anticipo sobre ${base}` : "Anticipo";
  }

  if (calculation.modo_calculo === "cuantia_fija") {
    return calculation.tipo_amparo === "responsabilidad_civil_extracontractual"
      ? "Cuantía RCE"
      : "Cuantía fija";
  }

  if (calculation.modo_calculo === "valor_asegurado_manual") {
    return "Valor manual";
  }

  if (calculation.modo_calculo === "porcentaje_valor_contrato" && percentage) {
    return `${percentage}% de ${base}`;
  }

  return "Por definir";
}

function sumNullable(values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null);

  return present.length === 0
    ? null
    : roundMoney(present.reduce((total, value) => total + value, 0));
}

function summarizePremiums(calculations: AmparoCalculation[]) {
  return {
    prima_neta: sumNullable(calculations.map((item) => item.prima_neta)),
    iva: sumNullable(calculations.map((item) => item.impuesto)),
    prima_total: sumNullable(calculations.map((item) => item.prima_total)),
  };
}

function PolicyHeader({
  label,
  totals,
  currency,
}: {
  label: string;
  totals: ReturnType<typeof summarizePremiums>;
  currency: string;
}) {
  return (
    <div
      className="mt-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-lg bg-neutral-100 px-4 py-2 first:mt-0"
    >
      <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-neutral-900">
        {label}
      </h3>
      <p className="text-sm text-neutral-700">
        Prima neta{" "}
        <strong className="font-semibold text-neutral-950">
          {formatCurrency(totals.prima_neta, currency)}
        </strong>
        {" · "}IVA{" "}
        <strong className="font-semibold text-neutral-950">
          {formatCurrency(totals.iva, currency)}
        </strong>
        {" · "}Prima total{" "}
        <strong className="font-semibold text-[#b94d28]">
          {formatCurrency(totals.prima_total, currency)}
        </strong>
      </p>
    </div>
  );
}

function SummaryItem({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-neutral-500">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm font-semibold text-neutral-950">
        {value}
      </dd>
      {hint ? (
        <dd className="mt-0.5 break-words text-xs text-neutral-500">{hint}</dd>
      ) : null}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
      {children}
    </h4>
  );
}

const selectClass =
  "h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15";

function AmparoCard({
  amparo,
  calculation,
  form,
  isManual,
  validated,
  onEditingChange,
  onChange,
  onDateOverride,
  onRemove,
}: {
  amparo: EditableAmparo;
  calculation: AmparoCalculation;
  form: ContractForm;
  isManual: boolean;
  validated: boolean;
  onEditingChange: (
    uid: string,
    editing: boolean,
    policy: CoveragePolicy,
  ) => void;
  onChange: (
    key: keyof EditableAmparo,
    value: string | boolean | CoverageSubamparo[],
  ) => void;
  onDateOverride: (
    manualKey: "fecha_desde_manual" | "fecha_hasta_manual",
    valueKey: "fecha_desde" | "fecha_hasta",
    checked: boolean,
    calculatedValue: string | null,
  ) => void;
  onRemove: () => void;
}) {
  const currency = form.moneda || "COP";
  const reviewReason = mergeReviewReasons(
    amparo.motivo_revision,
    calculation.motivo_revision,
  );
  const needsReview = Boolean(reviewReason) && !validated;
  const hasSource = !isManual && Boolean(amparo.fuente_texto || amparo.fuente_pagina);
  const [open, setOpen] = useState(
    () => amparo.uid.startsWith("new-") || needsReview,
  );
  const [sourceOpen, setSourceOpen] = useState(false);
  const [datesOpen, setDatesOpen] = useState(
    amparo.fecha_desde_manual || amparo.fecha_hasta_manual,
  );
  const [detailOpen, setDetailOpen] = useState(false);
  const policy = classifyCoveragePolicy(calculation.tipo_amparo);
  const uid = amparo.uid;

  useEffect(() => {
    if (!open) {
      return;
    }

    onEditingChange(uid, true, policy);

    return () => onEditingChange(uid, false, policy);
    // policy se congela al abrir el editor; no debe re-ejecutarse al cambiar el tipo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, uid, onEditingChange]);

  const isAdvance = calculation.tipo_amparo === "buen_manejo_anticipo";
  const coverageMode = getEditableCoverageMode(amparo, calculation);
  const rateIssue = getRateInputIssue(amparo.tasa);
  const rate = decimalFromRatePercent(amparo.tasa);
  const manualDatesActive = amparo.fecha_desde_manual || amparo.fecha_hasta_manual;
  const title = amparo.tipo_amparo.trim()
    ? formatCoverageName(calculation.tipo_amparo)
    : "Amparo nuevo";
  const validity =
    calculation.fecha_desde && calculation.fecha_hasta
      ? `${formatDate(calculation.fecha_desde)} → ${formatDate(calculation.fecha_hasta)}`
      : "Por definir";

  return (
    <article
      className={`rounded-lg border bg-white ${needsReview ? "border-amber-300" : "border-neutral-200"}`}
    >
      <div className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {isManual ? null : <ConfidenceDot confidence={amparo.confianza} />}
              <h4 className="text-base font-semibold text-neutral-950">{title}</h4>
              <ReviewChip tone={needsReview ? "review" : "ok"}>
                {validated ? "Validado" : needsReview ? "Revisar" : "Listo"}
              </ReviewChip>
            </div>
            {needsReview ? (
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-amber-800">
                {reviewReason}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasSource ? (
              <button
                type="button"
                aria-expanded={sourceOpen}
                onClick={() => setSourceOpen((value) => !value)}
                className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-50"
              >
                {sourceOpen ? "Ocultar fuente" : "Ver fuente"}
              </button>
            ) : null}
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
              className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-50"
            >
              {open ? "Cerrar" : "Editar"}
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="h-9 rounded-lg border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
            >
              Quitar
            </button>
          </div>
        </div>

        <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryItem
            label="Valor asegurado"
            value={formatCurrency(calculation.valor_asegurado, currency)}
            hint={describeInsuredValue(calculation, currency)}
          />
          <SummaryItem
            label="Vigencia"
            value={validity}
            hint={`${calculation.dias_vigencia?.toString() ?? "Sin dato"} días${manualDatesActive ? " · fechas manuales" : ""}`}
          />
          <SummaryItem
            label="Tasa"
            value={
              rate === null
                ? "Sin tasa"
                : `${formatRatePercent(rate)}%${amparo.tasa_manual ? " manual" : ""}`
            }
          />
          <SummaryItem
            label={
              calculation.usar_prima_neta_manual ? "Prima neta (manual)" : "Prima neta"
            }
            value={formatCurrency(calculation.prima_neta, currency)}
            hint={`Total ${formatCurrency(calculation.prima_total, currency)}`}
          />
        </dl>

        {sourceOpen && hasSource ? (
          <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs leading-5 text-neutral-600">
            <p className="font-semibold text-neutral-700">
              Pág. {amparo.fuente_pagina || "sin dato"}
            </p>
            <p className="mt-1 whitespace-pre-wrap">
              {amparo.fuente_texto || "Sin texto de fuente."}
            </p>
          </div>
        ) : null}
      </div>

      {open ? (
        <div className="space-y-5 border-t border-neutral-200 bg-neutral-50 p-4">
          <EditableAmparoField
            label="Tipo de amparo"
            value={amparo.tipo_amparo}
            onChange={(value) => onChange("tipo_amparo", value)}
          />

          <div className="space-y-3">
            <SectionTitle>Valor asegurado</SectionTitle>
            {isAdvance ? (
              <div className="grid gap-4 md:grid-cols-2">
                <EditableAmparoField
                  label="Porcentaje anticipo %"
                  type="text"
                  inputMode="decimal"
                  value={percentFromDecimal(calculation.porcentaje)}
                  onChange={(value) => onChange("porcentaje", value)}
                  help="Digite 20 para representar 20%."
                />
                <EditableAmparoField
                  label="Base/valor anticipo"
                  type="text"
                  inputMode="decimal"
                  value={amparo.valor_base_calculo}
                  onChange={(value) => onChange("valor_base_calculo", value)}
                  onBlur={(value) =>
                    onChange("valor_base_calculo", formatCurrencyInputValue(value))
                  }
                  help="Edite este valor si la base del anticipo no corresponde al valor total del contrato."
                />
              </div>
            ) : (
              <>
                <div
                  role="radiogroup"
                  aria-label="Cómo se obtiene el valor asegurado"
                  className="inline-flex flex-wrap gap-1 rounded-lg border border-neutral-200 bg-white p-1"
                >
                  {INSURED_VALUE_MODES.map((mode) => (
                    <button
                      key={mode.value}
                      type="button"
                      role="radio"
                      aria-checked={coverageMode === mode.value}
                      onClick={() => onChange("modo_calculo", mode.value)}
                      className={
                        coverageMode === mode.value
                          ? "h-8 rounded-md bg-[#d25b30] px-3 text-sm font-semibold text-white"
                          : "h-8 rounded-md px-3 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
                      }
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
                <div className="max-w-sm">
                  {coverageMode === "porcentaje_valor_contrato" ? (
                    <EditableAmparoField
                      label="Porcentaje %"
                      type="text"
                      inputMode="decimal"
                      value={amparo.porcentaje}
                      onChange={(value) => onChange("porcentaje", value)}
                      help="Digite 20 para representar 20%."
                    />
                  ) : null}
                  {coverageMode === "cuantia_fija" ? (
                    <EditableAmparoField
                      label="Cuantía fija"
                      type="text"
                      inputMode="decimal"
                      value={amparo.cuantia_fija}
                      onChange={(value) => onChange("cuantia_fija", value)}
                      onBlur={(value) =>
                        onChange("cuantia_fija", formatCurrencyInputValue(value))
                      }
                    />
                  ) : null}
                  {coverageMode === "valor_asegurado_manual" ? (
                    <EditableAmparoField
                      label="Valor asegurado"
                      type="text"
                      inputMode="decimal"
                      value={amparo.valor_asegurado}
                      onChange={(value) => onChange("valor_asegurado", value)}
                      onBlur={(value) =>
                        onChange("valor_asegurado", formatCurrencyInputValue(value))
                      }
                    />
                  ) : null}
                </div>
              </>
            )}
          </div>

          <div className="space-y-3">
            <SectionTitle>Vigencia</SectionTitle>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-2">
                <span className="text-sm font-medium text-neutral-700">Tipo</span>
                <select
                  value={amparo.tipo_vigencia}
                  onChange={(event) => onChange("tipo_vigencia", event.target.value)}
                  className={selectClass}
                >
                  <option value="">Sin dato</option>
                  <option value="contractual">Contractual</option>
                  <option value="post_contractual">Post contractual</option>
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-neutral-700">Base</span>
                <select
                  value={amparo.base_vigencia}
                  onChange={(event) => onChange("base_vigencia", event.target.value)}
                  className={selectClass}
                >
                  <option value="">Sin dato</option>
                  <option value="fecha_inicio_contrato">Inicio contrato</option>
                  <option value="fecha_fin_contrato">Fin contrato</option>
                  <option value="acta_recibo_final">Acta recibo final</option>
                  <option value="firma_contrato">Firma contrato</option>
                  <option value="otra">Otra</option>
                </select>
              </label>
              {amparo.fecha_hasta_manual ? (
                <p className="text-xs leading-5 text-neutral-500 md:col-span-2">
                  El periodo adicional no se aplica mientras la fecha fin manual
                  esté activa.
                </p>
              ) : (
                <>
                  <EditableAmparoField
                    label="Periodo adicional"
                    type="text"
                    inputMode="numeric"
                    value={amparo.periodo_cantidad}
                    onChange={(value) => onChange("periodo_cantidad", value)}
                    help={
                      calculation.dias_adicionales === null
                        ? "Vacío aplica la regla automática."
                        : `Equivale a ${calculation.dias_adicionales} días.`
                    }
                  />
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-neutral-700">
                      Unidad
                    </span>
                    <select
                      value={amparo.periodo_unidad}
                      onChange={(event) =>
                        onChange("periodo_unidad", event.target.value)
                      }
                      className={selectClass}
                    >
                      <option value="dias">Días</option>
                      <option value="meses">Meses</option>
                      <option value="anios">Años</option>
                    </select>
                  </label>
                </>
              )}
            </div>
            <button
              type="button"
              aria-expanded={datesOpen}
              onClick={() => setDatesOpen((value) => !value)}
              className="text-sm font-semibold text-[#b94d28] underline-offset-2 hover:underline"
            >
              {datesOpen ? "Ocultar fechas manuales" : "Ajustar fechas manualmente"}
              {!datesOpen && manualDatesActive ? " · activo" : ""}
            </button>
            {datesOpen ? (
              <div className="grid gap-4 md:grid-cols-2">
                <ManualDateOverride
                  checkboxLabel="Usar fecha inicio manual para este amparo"
                  fieldLabel="Fecha inicio manual"
                  checked={amparo.fecha_desde_manual}
                  value={amparo.fecha_desde}
                  onCheckedChange={(checked) =>
                    onDateOverride(
                      "fecha_desde_manual",
                      "fecha_desde",
                      checked,
                      calculation.fecha_desde,
                    )
                  }
                  onValueChange={(value) => onChange("fecha_desde", value)}
                  warning={
                    amparo.fecha_desde_manual
                      ? getRequiredDateInputIssue("Fecha inicio manual", amparo.fecha_desde)
                      : null
                  }
                />
                <ManualDateOverride
                  checkboxLabel="Usar fecha fin manual para este amparo"
                  fieldLabel="Fecha fin manual"
                  checked={amparo.fecha_hasta_manual}
                  value={amparo.fecha_hasta}
                  onCheckedChange={(checked) =>
                    onDateOverride(
                      "fecha_hasta_manual",
                      "fecha_hasta",
                      checked,
                      calculation.fecha_hasta,
                    )
                  }
                  onValueChange={(value) => onChange("fecha_hasta", value)}
                  warning={
                    amparo.fecha_hasta_manual
                      ? getRequiredDateInputIssue("Fecha fin manual", amparo.fecha_hasta)
                      : null
                  }
                />
                <p className="text-xs leading-5 text-neutral-500 md:col-span-2">
                  Úselas solo si la póliza tiene una vigencia distinta a la del
                  contrato.
                </p>
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <SectionTitle>Prima</SectionTitle>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <EditableAmparoField
                label="Tasa (%)"
                type="text"
                inputMode="decimal"
                value={amparo.tasa}
                onChange={(value) => onChange("tasa", value)}
                help="Digite 0.20 para una tasa de 0,20%. No use 20."
                warning={rateIssue}
              />
            </div>
            <label className="flex min-h-10 items-center gap-3 rounded-lg border border-neutral-300 bg-white px-3 py-2">
              <input
                type="checkbox"
                checked={amparo.usar_prima_neta_manual}
                onChange={(event) =>
                  onChange("usar_prima_neta_manual", event.target.checked)
                }
                className="h-4 w-4 rounded border-neutral-300 text-[#d25b30] focus:ring-[#d25b30]"
              />
              <span>
                <span className="block text-sm font-medium text-neutral-800">
                  Usar prima neta manual
                </span>
                <span className="block text-xs leading-5 text-neutral-500">
                  Mantiene este valor aunque cambien tasa, fechas o días.
                </span>
              </span>
            </label>
            {amparo.usar_prima_neta_manual ? (
              <div className="max-w-sm">
                <EditableAmparoField
                  label="Prima neta manual"
                  type="text"
                  inputMode="decimal"
                  value={amparo.prima_neta_manual}
                  onChange={(value) => onChange("prima_neta_manual", value)}
                  onBlur={(value) =>
                    onChange("prima_neta_manual", formatCurrencyInputValue(value))
                  }
                  help={`El IVA y la prima total se calculan sobre este valor. Prima automática de referencia: ${formatCurrency(calculation.prima_neta_automatica, currency)}.`}
                />
              </div>
            ) : null}
          </div>

          {calculation.subamparos.length > 0 ? (
            <SubcoverageEditor
              subamparos={calculation.subamparos}
              currency={currency}
              mainInsuredValue={calculation.valor_asegurado}
              validated={validated}
              onChange={(nextSubamparos) => onChange("subamparos", nextSubamparos)}
            />
          ) : null}

          <div className="space-y-3">
            <button
              type="button"
              aria-expanded={detailOpen}
              onClick={() => setDetailOpen((value) => !value)}
              className="text-sm font-semibold text-[#b94d28] underline-offset-2 hover:underline"
            >
              {detailOpen ? "Ocultar detalle y evidencia" : "Detalle y evidencia"}
            </button>
            {detailOpen ? (
              <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
                {isManual ? null : (
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-neutral-600">
                    <span className="inline-flex items-center gap-2">
                      <ConfidenceDot confidence={amparo.confianza} />
                      {getConfidenceLabel(amparo.confianza) ?? "Confianza sin dato"}
                    </span>
                    <span>Página {amparo.fuente_pagina || "sin dato"}</span>
                  </div>
                )}
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-neutral-700">
                    {isManual ? "Fuente / soporte (opcional)" : "Fuente"}
                  </span>
                  <textarea
                    value={amparo.fuente_texto}
                    onChange={(event) => onChange("fuente_texto", event.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
                  />
                </label>
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-neutral-700">
                    {validated && reviewReason
                      ? "Advertencia detectada por IA antes de la validación"
                      : "Motivo de revisión"}
                  </span>
                  <textarea
                    value={reviewReason}
                    onChange={(event) => onChange("motivo_revision", event.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
                  />
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-neutral-600">
                  <input
                    type="checkbox"
                    checked={amparo.requiere_revision || Boolean(calculation.motivo_revision)}
                    onChange={(event) =>
                      onChange("requiere_revision", event.target.checked)
                    }
                    className="h-4 w-4 rounded border-neutral-300 text-[#d25b30] focus:ring-[#d25b30]"
                  />
                  Requiere revisión
                </label>
                <dl className="grid gap-3 text-sm sm:grid-cols-3">
                  <SummaryItem
                    label="IVA"
                    value={`${formatPercent(calculation.iva_porcentaje)}%`}
                  />
                  {isAdvance ? (
                    <SummaryItem
                      label="Criterio base"
                      value={getAdvanceBaseCriterion(calculation, form)}
                    />
                  ) : null}
                  {isAdvance ? (
                    <SummaryItem
                      label="Origen anticipo"
                      value={getAdvanceBaseOrigin(amparo, form)}
                    />
                  ) : null}
                </dl>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function SourceBlock({ source }: { source?: SourceMeta }) {
  const [open, setOpen] = useState(false);

  if (!source) {
    return null;
  }

  const level = source.confianza ?? null;
  const hasFragment = Boolean(source.fuente);
  const hasPage = source.pagina !== null && source.pagina !== undefined;
  const emphasized = level === "baja" || level === "media";

  if (!hasFragment && !hasPage && !emphasized) {
    return null;
  }

  return (
    <div className="text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <ConfidenceDot confidence={level} />
        <span
          className={
            level === "baja"
              ? "font-semibold text-rose-700"
              : level === "media"
                ? "font-semibold text-amber-700"
                : "text-neutral-500"
          }
        >
          {hasPage ? `Pág. ${source.pagina}` : "Sin evidencia en el documento"}
        </span>
        {hasFragment ? (
          <>
            <span aria-hidden className="text-neutral-300">
              ·
            </span>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
              className="font-semibold text-[#b94d28] underline-offset-2 hover:underline"
            >
              {open ? "Ocultar fuente" : "Ver fuente"}
            </button>
          </>
        ) : null}
      </div>
      {open && hasFragment ? (
        <p className="mt-2 whitespace-pre-wrap rounded-lg border border-neutral-200 bg-neutral-50 p-3 leading-5 text-neutral-600">
          {source.fuente}
        </p>
      ) : null}
    </div>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-medium text-neutral-500">{label}</dt>
      <dd className="mt-1 break-words text-neutral-900">{value}</dd>
    </div>
  );
}

async function fetchContractDetail(contractId: string) {
  const response = await fetch(`/api/contracts/${contractId}`, {
    cache: "no-store",
  });
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error ?? "No se pudo cargar el contrato.");
  }

  return body as DetailResponse;
}

function normalizeExecutiveForForm(value: string | null | undefined): string {
  return value && EXECUTIVES.some((executive) => executive === value)
    ? value
    : DEFAULT_EXECUTIVE;
}

function getInitialContractDetailTab(): ContractDetailTab {
  if (typeof window === "undefined") {
    return "contrato";
  }

  const tab = new URLSearchParams(window.location.search).get("tab");

  return CONTRACT_DETAIL_TABS.some((item) => item.id === tab)
    ? (tab as ContractDetailTab)
    : "contrato";
}

function contractToForm(
  contract: Contrato,
  extraction: AIExtraction | null,
  amparos: Amparo[] = [],
): ContractForm {
  const calculationBase =
    contract.base_calculo_amparos ??
    amparos.find((amparo) => amparo.valor_base_calculo !== null)
      ?.valor_base_calculo ??
    contract.valor_contrato;
  const plazoSource =
    contract.plazo ??
    extraction?.plazo?.valor ??
    extraction?.plazo?.fuente ??
    "";
  const plazoDias = extractPlazoDias(plazoSource);
  const fechaInicio = normalizeDateValue(contract.fecha_inicio) ?? "";
  const fechaFin = normalizeDateValue(contract.fecha_fin) ?? "";

  return {
    numero_contrato: contract.numero_contrato ?? "",
    objeto: contract.objeto ?? "",
    tipo_contrato:
      contract.tipo_contrato === "estatal" || contract.tipo_contrato === "particular"
        ? contract.tipo_contrato
        : "",
    valor_contrato:
      contract.valor_contrato === null
        ? ""
        : formatCurrencyInputValue(String(contract.valor_contrato)),
    base_calculo_amparos:
      calculationBase === null
        ? ""
        : formatCurrencyInputValue(String(calculationBase)),
    base_calculo_incluye_iva:
      booleanToIvaChoice(contract.base_calculo_incluye_iva) ??
      inferBaseIncludesIvaChoice(extraction),
    moneda: normalizeCurrencyValue(contract.moneda),
    fecha_inicio: fechaInicio,
    fecha_fin: fechaFin,
    fecha_fin_manual: isLoadedContractEndManual(
      fechaInicio,
      fechaFin,
      plazoDias,
    ),
    plazo_dias: plazoDias === null ? "" : String(plazoDias),
    plazo: contract.plazo ?? "",
    renovable_automaticamente: contract.renovable_automaticamente ? "si" : "no",
    origen_manual: contract.origen === "manual",
    contratante: contract.contratante ?? "",
    contratante_nit: contract.contratante_nit ?? "",
    contratista: contract.contratista ?? "",
    contratista_nit: contract.contratista_nit ?? "",
  };
}

function amparoToEditable(
  amparo: Amparo,
  tasasReferencia: TasaReferencia[] = [],
): EditableAmparo {
  const suggestedRate = findSuggestedRate(amparo.tipo_amparo, tasasReferencia);
  const tasa = amparo.tasa ?? suggestedRate;

  return {
    uid: `db-${amparo.id}`,
    id: amparo.id,
    tipo_amparo: amparo.tipo_amparo,
    porcentaje: percentFromDecimal(amparo.porcentaje),
    cuantia_fija:
      amparo.cuantia_fija === null
        ? ""
        : formatCurrencyInputValue(String(amparo.cuantia_fija)),
    valor_asegurado:
      amparo.valor_asegurado === null
        ? ""
        : formatCurrencyInputValue(String(amparo.valor_asegurado)),
    tasa: tasa === null ? "" : formatRatePercent(tasa),
    tasa_manual: amparo.tasa_manual ?? false,
    iva_porcentaje: String(amparo.iva_porcentaje ?? DEFAULT_IVA_PERCENTAGE),
    tipo_vigencia:
      amparo.tipo_vigencia === "contractual" ||
      amparo.tipo_vigencia === "post_contractual"
        ? amparo.tipo_vigencia
        : "",
    base_vigencia:
      amparo.base_vigencia === "fecha_inicio_contrato" ||
      amparo.base_vigencia === "fecha_fin_contrato" ||
      amparo.base_vigencia === "acta_recibo_final" ||
      amparo.base_vigencia === "firma_contrato" ||
      amparo.base_vigencia === "otra"
        ? amparo.base_vigencia
        : "",
    fecha_desde: amparo.fecha_desde_manual
      ? normalizeDateValue(amparo.fecha_desde) ?? ""
      : "",
    fecha_desde_manual: amparo.fecha_desde_manual ?? false,
    fecha_hasta: amparo.fecha_hasta_manual
      ? normalizeDateValue(amparo.fecha_hasta) ?? ""
      : "",
    fecha_hasta_manual: amparo.fecha_hasta_manual ?? false,
    periodo_cantidad:
      amparo.periodo_adicional_cantidad != null &&
      amparo.periodo_adicional_unidad
        ? String(amparo.periodo_adicional_cantidad)
        : amparo.dias_adicionales === null
          ? ""
          : String(amparo.dias_adicionales),
    periodo_unidad:
      amparo.periodo_adicional_cantidad != null
        ? (amparo.periodo_adicional_unidad ?? "dias")
        : "dias",
    dias_vigencia:
      amparo.dias_vigencia === null ? "" : String(amparo.dias_vigencia),
    prima_neta: amparo.prima_neta === null ? "" : String(amparo.prima_neta),
    prima_neta_manual:
      amparo.prima_neta_manual == null
        ? ""
        : formatCurrencyInputValue(String(amparo.prima_neta_manual)),
    usar_prima_neta_manual: amparo.usar_prima_neta_manual ?? false,
    impuesto: amparo.impuesto === null ? "" : String(amparo.impuesto),
    prima_total: amparo.prima_total === null ? "" : String(amparo.prima_total),
    valor_base_calculo:
      amparo.valor_base_calculo === null
        ? ""
        : formatCurrencyInputValue(String(amparo.valor_base_calculo)),
    modo_calculo: amparo.modo_calculo ?? "",
    fuente_pagina:
      amparo.fuente_pagina === null ? "" : String(amparo.fuente_pagina),
    fuente_texto: amparo.fuente_texto ?? "",
    subamparos: parseSubamparos(amparo.subamparos),
    confianza:
      amparo.confianza === "alta" ||
      amparo.confianza === "media" ||
      amparo.confianza === "baja"
        ? amparo.confianza
        : "",
    requiere_revision: amparo.requiere_revision,
    motivo_revision: amparo.motivo_revision ?? "",
  };
}

function newAmparo(): EditableAmparo {
  newAmparoSequence += 1;

  return {
    uid: `new-${newAmparoSequence}`,
    tipo_amparo: "",
    porcentaje: "",
    cuantia_fija: "",
    valor_asegurado: "",
    tasa: "",
    tasa_manual: false,
    iva_porcentaje: String(DEFAULT_IVA_PERCENTAGE),
    tipo_vigencia: "",
    base_vigencia: "",
    fecha_desde: "",
    fecha_desde_manual: false,
    fecha_hasta: "",
    fecha_hasta_manual: false,
    periodo_cantidad: "",
    periodo_unidad: "dias",
    dias_vigencia: "",
    prima_neta: "",
    prima_neta_manual: "",
    usar_prima_neta_manual: false,
    impuesto: "",
    prima_total: "",
    valor_base_calculo: "",
    modo_calculo: "",
    fuente_pagina: "",
    fuente_texto: "",
    subamparos: [],
    confianza: "",
    requiere_revision: true,
    motivo_revision: "",
  };
}

function updateForm(
  setForm: (updater: (current: ContractForm) => ContractForm) => void,
  key: EditableContractFormKey,
  value: string,
) {
  setForm((current) => applyContractTimingUpdate(current, key, value));
}

function applyContractTimingUpdate(
  current: ContractForm,
  key: EditableContractFormKey,
  value: string,
): ContractForm {
  const next: ContractForm = {
    ...current,
    [key]: value,
  } as ContractForm;

  if (key === "plazo") {
    const nextDays = extractPlazoDias(value);

    if (nextDays !== null) {
      next.plazo_dias = String(nextDays);
    }
  }

  if (key === "plazo_dias") {
    next.plazo = upsertPlazoDaysText(next.plazo, value);
  }

  if (key === "fecha_fin") {
    return {
      ...next,
      fecha_fin_manual: true,
    };
  }

  if (key === "fecha_inicio" || key === "plazo_dias" || key === "plazo") {
    return recalculateContractEndDate(next, false);
  }

  return next;
}

function recalculateContractEndDate(
  form: ContractForm,
  force: boolean,
): ContractForm {
  if (form.fecha_fin_manual && !force && normalizeDateValue(form.fecha_fin)) {
    return form;
  }

  const startDate = normalizeDateValue(form.fecha_inicio);
  const days = integerOrNull(form.plazo_dias);

  if (!startDate || days === null || days <= 0) {
    return force ? { ...form, fecha_fin_manual: false } : form;
  }

  return {
    ...form,
    fecha_fin: addDaysToDate(startDate, days),
    fecha_fin_manual: false,
  };
}

function extractPlazoDias(value: string | null | undefined) {
  const text = normalizeTextValue(value);

  if (!text) {
    return null;
  }

  const normalized = normalizeForLooseMatch(text);
  const parenthesizedDays = normalized.match(/\((\d+)\)\s*dias?\b/);

  if (parenthesizedDays) {
    return integerOrNull(parenthesizedDays[1]);
  }

  const numericDays = normalized.match(/\b(\d+)\s*dias?\b/);

  if (numericDays) {
    return integerOrNull(numericDays[1]);
  }

  if (normalized.includes("doscientos cuarenta")) {
    return 240;
  }

  return null;
}

function isLoadedContractEndManual(
  startDate: string,
  endDate: string,
  plazoDias: number | null,
) {
  if (!startDate || !endDate || plazoDias === null) {
    return false;
  }

  return addDaysToDate(startDate, plazoDias) !== endDate;
}

function addDaysToDate(date: string, days: number) {
  return addDaysToDateOnly(date, days) ?? "";
}

function upsertPlazoDaysText(current: string, daysValue: string) {
  const days = integerOrNull(daysValue);

  if (days === null || days <= 0) {
    return current;
  }

  if (!current.trim()) {
    return `${days} días`;
  }

  if (/\(\d+\)\s*d[ií]as?\b/i.test(current)) {
    return current.replace(/\(\d+\)\s*d[ií]as?\b/i, `(${days}) días`);
  }

  if (/\b\d+\s*d[ií]as?\b/i.test(current)) {
    return current.replace(/\b\d+\s*d[ií]as?\b/i, `${days} días`);
  }

  return `${current}; plazo calculable: ${days} días`;
}

function buildPersistedPlazo(form: ContractForm) {
  return upsertPlazoDaysText(form.plazo, form.plazo_dias);
}

function contractDependsOnActaInicio(
  form: ContractForm,
  extraction: AIExtraction | null,
) {
  const haystack = [
    form.plazo,
    extraction?.plazo?.valor,
    extraction?.plazo?.fuente,
    extraction?.fecha_inicio?.fuente,
    extraction?.fecha_fin?.fuente,
    ...(extraction?.alertas ?? []),
  ]
    .filter(Boolean)
    .join(" ");

  const normalized = normalizeForLooseMatch(haystack);

  return (
    normalized.includes("acta de inicio") &&
    (normalized.includes("a partir") ||
      normalized.includes("contado") ||
      normalized.includes("contados") ||
      normalized.includes("plazo") ||
      normalized.includes("duracion"))
  );
}

function getRenewalExpirationAlert(contract: Contrato, amparos: Amparo[]) {
  if (!contract.renovable_automaticamente) {
    return null;
  }

  const today = getTodayDateOnly();
  const complianceEndDate =
    amparos.find((amparo) =>
      normalizeText(amparo.tipo_amparo).includes("cumplimiento"),
    )?.fecha_hasta ?? null;
  const watchedDates = [
    { label: "contrato base", value: contract.fecha_fin },
    { label: "amparo de cumplimiento", value: complianceEndDate },
  ];
  const expiring = watchedDates
    .map((item) => ({
      ...item,
      days: item.value ? diffDaysDateOnly(today, item.value) : null,
    }))
    .find((item) => item.days !== null && item.days >= 0 && item.days <= 30);

  if (!expiring || expiring.days === null) {
    return null;
  }

  return `Contrato renovable: ${expiring.label} vence en ${expiring.days} día${expiring.days === 1 ? "" : "s"}. Revise si corresponde prorrogar.`;
}

function getTodayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeForLooseMatch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function numberOrNull(value: string | number | null | undefined) {
  return parseLocalizedNumber(value);
}

function integerOrNull(value: string | number | null | undefined) {
  return normalizeIntegerValue(value);
}

function decimalFromPercent(value: string | number | null | undefined) {
  const parsed = numberOrNull(value);
  return parsed === null ? null : parsed / 100;
}

function decimalFromRatePercent(value: string | number | null | undefined) {
  const parsed = numberOrNull(value);

  if (parsed === null || parsed > MAX_RATE_PERCENT_INPUT) {
    return null;
  }

  return parsed / 100;
}

const MAX_RATE_PERCENT_INPUT = 5;

function getContractDateIssues(form: ContractForm) {
  return [
    getDateInputIssue("Fecha inicio", form.fecha_inicio),
    getDateInputIssue("Fecha fin", form.fecha_fin),
  ].filter((issue): issue is string => issue !== null);
}

function getManualDateIssues(amparos: EditableAmparo[]) {
  return amparos.flatMap((amparo) => {
    const issues = [];

    if (amparo.fecha_desde_manual) {
      const issue = getRequiredDateInputIssue(
        `Fecha inicio manual de ${amparo.tipo_amparo || "amparo"}`,
        amparo.fecha_desde,
      );

      if (issue) {
        issues.push(issue);
      }
    }

    if (amparo.fecha_hasta_manual) {
      const issue = getRequiredDateInputIssue(
        `Fecha fin manual de ${amparo.tipo_amparo || "amparo"}`,
        amparo.fecha_hasta,
      );

      if (issue) {
        issues.push(issue);
      }
    }

    return issues;
  });
}

function getDateInputIssue(label: string, value: string): string | null {
  if (!value.trim()) {
    return null;
  }

  if (!normalizeDateValue(value)) {
    return `${label} está incompleta o no es válida; complete la fecha antes de recalcular.`;
  }

  return null;
}

function getRequiredDateInputIssue(label: string, value: string): string | null {
  if (!value.trim()) {
    return `${label} debe completarse para usarla como fecha manual.`;
  }

  return getDateInputIssue(label, value);
}

function formatDateInputValue(value: string) {
  if (!value) {
    return "";
  }

  const normalized = normalizeDateValue(value);

  if (normalized) {
    const [year, month, day] = normalized.split("-");

    return `${day}/${month}/${year}`;
  }

  return maskDateInput(value);
}

function normalizeDateInputChange(value: string) {
  const masked = maskDateInput(value);
  const normalized = normalizeDateValue(masked);

  return normalized ?? masked;
}

function maskDateInput(value: string) {
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }

  const digits = value.replace(/\D/g, "").slice(0, 8);

  if (digits.length <= 2) {
    return digits;
  }

  if (digits.length <= 4) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }

  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function getRateInputIssues(amparos: EditableAmparo[]) {
  return amparos
    .map((amparo) => getRateInputIssue(amparo.tasa))
    .filter((issue): issue is string => issue !== null);
}

function getRateInputIssue(
  value: string | number | null | undefined,
): string | null {
  const raw = String(value ?? "").trim();

  if (!raw) {
    return null;
  }

  const parsed = numberOrNull(raw);

  if (parsed === null) {
    return "La tasa no es válida. Digite valores como 0.20, 0.18 o 0.25.";
  }

  if (parsed > MAX_RATE_PERCENT_INPUT) {
    return "La tasa parece estar escrita como 20. Digite 0.20 para una tasa de 0,20%.";
  }

  return null;
}

function booleanOrNullFromChoice(value: ContractForm["base_calculo_incluye_iva"]) {
  if (value === "si") {
    return true;
  }

  if (value === "no") {
    return false;
  }

  return null;
}

function booleanToIvaChoice(value: boolean | null | undefined) {
  if (value === true) {
    return "si" as const;
  }

  if (value === false) {
    return "no" as const;
  }

  return null;
}

function inferBaseIncludesIvaChoice(extraction: AIExtraction | null) {
  const source = normalizeTextValue(extraction?.valor_contrato?.fuente);

  if (!source) {
    return "no_determinado" as const;
  }

  const normalized = source
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (
    normalized.includes("incluido iva") ||
    normalized.includes("iva incluido") ||
    normalized.includes("incluye iva") ||
    normalized.includes("incluido el iva")
  ) {
    return "si" as const;
  }

  if (normalized.includes("sin iva") || normalized.includes("no incluye iva")) {
    return "no" as const;
  }

  return "no_determinado" as const;
}

function getCalculationBase(contract: ContractForm) {
  return numberOrNull(contract.base_calculo_amparos) ??
    numberOrNull(contract.valor_contrato);
}

function getCoverageBaseDisplayValue(
  calculation: ReturnType<typeof calculateEditableAmparo>,
) {
  if (
    calculation.modo_calculo === "cuantia_fija" ||
    calculation.tipo_amparo === "responsabilidad_civil_extracontractual"
  ) {
    return calculation.cuantia_fija ?? calculation.valor_asegurado;
  }

  return calculation.valor_base_calculo;
}

function getAdvanceBaseCriterion(
  calculation: ReturnType<typeof calculateEditableAmparo>,
  contract: ContractForm,
) {
  const contractValue = numberOrNull(contract.valor_contrato);

  if (
    calculation.valor_base_calculo !== null &&
    contractValue !== null &&
    calculation.valor_base_calculo < contractValue
  ) {
    return "Sin IVA";
  }

  if (contract.base_calculo_incluye_iva === "si") {
    return "Con IVA";
  }

  return "No determinado";
}

function getAdvanceBaseOrigin(amparo: EditableAmparo, contract: ContractForm) {
  const manualBase = numberOrNull(amparo.valor_base_calculo);
  const contractBase = getCalculationBase(contract);

  if (manualBase === null) {
    return "Valor del contrato";
  }

  if (contractBase !== null && Math.abs(manualBase - contractBase) < 1) {
    return "Valor del contrato";
  }

  return "Base específica revisada";
}

function formatRatePercent(value: number | null | undefined) {
  if (value === null || typeof value === "undefined") {
    return "";
  }

  return new Intl.NumberFormat("es-CO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(value * 100);
}

function mergeReviewReasons(
  ...parts: Array<string | null | undefined>
) {
  const [savedReason, ...currentReasons] = parts;

  return [
    savedReason ? stripStaleAutomaticReviewReasons(savedReason) : null,
    ...currentReasons,
  ]
    .filter((part): part is string => Boolean(part))
    .flatMap(splitReviewReasons)
    .filter((part, index, list) => list.indexOf(part) === index)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitReviewReasons(value: string) {
  return value
    .split(/(?<=\.)\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function stripStaleAutomaticReviewReasons(value: string) {
  return [
    "Falta tasa para calcular prima.",
    "Faltan fechas suficientes para calcular días de vigencia.",
    "Falta fecha fin del contrato para calcular fecha hasta.",
    "Falta fecha fin del contrato para calcular fecha desde.",
    "No hay fecha desde suficiente para la vigencia del amparo.",
    "No hay base suficiente para calcular fecha hasta.",
    "Falta plazo contractual para calcular fecha hasta.",
    "Hay fechas inválidas para calcular días de vigencia.",
    "Los días de vigencia calculados son cero o negativos.",
    "No se pudo determinar la base de vigencia.",
    "Falta porcentaje o cuantía fija para calcular el amparo.",
    "No hay datos suficientes para calcular el valor asegurado.",
    "Valor asegurado ingresado manualmente sin regla de cálculo.",
  ].reduce(
    (current, reason) => current.split(reason).join(" "),
    value,
  );
}

function calculateEditableAmparo(amparo: EditableAmparo, contract: ContractForm) {
  const coverageMode = getEditableCoverageMode(amparo);
  const isFixedMode = coverageMode === "cuantia_fija";
  const isManualInsuredValueMode = coverageMode === "valor_asegurado_manual";

  return normalizeCoverage(
    {
      tipo_amparo: amparo.tipo_amparo || "Amparo sin clasificar",
      porcentaje: isFixedMode || isManualInsuredValueMode
        ? null
        : decimalFromPercent(amparo.porcentaje),
      cuantia_fija: isFixedMode ? numberOrNull(amparo.cuantia_fija) : null,
      valor_asegurado: isManualInsuredValueMode
        ? numberOrNull(amparo.valor_asegurado)
        : null,
      valor_base_calculo: numberOrNull(amparo.valor_base_calculo),
      tasa: decimalFromRatePercent(amparo.tasa),
      tasa_manual: amparo.tasa_manual,
      usar_prima_neta_manual: amparo.usar_prima_neta_manual,
      prima_neta_manual: numberOrNull(amparo.prima_neta_manual),
      iva_porcentaje:
        numberOrNull(amparo.iva_porcentaje) ?? DEFAULT_IVA_PERCENTAGE,
      tipo_vigencia: amparo.tipo_vigencia || null,
      base_vigencia: amparo.base_vigencia || null,
      periodo_adicional_cantidad: integerOrNull(amparo.periodo_cantidad),
      periodo_adicional_unidad: amparo.periodo_unidad,
      fecha_desde: amparo.fecha_desde_manual ? amparo.fecha_desde || null : null,
      fecha_desde_manual: amparo.fecha_desde_manual,
      fecha_hasta: amparo.fecha_hasta_manual ? amparo.fecha_hasta || null : null,
      fecha_hasta_manual: amparo.fecha_hasta_manual,
      fuente_texto: amparo.fuente_texto || null,
      fuente_pagina: integerOrNull(amparo.fuente_pagina),
      subamparos: amparo.subamparos,
      confianza: amparo.confianza || "baja",
    },
    {
      valorContrato: numberOrNull(contract.valor_contrato),
      baseCalculoAmparos: getCalculationBase(contract),
      anticipoBaseIncluyeIva: booleanOrNullFromChoice(
        contract.base_calculo_incluye_iva,
      ),
      fechaInicio: normalizeDateValue(contract.fecha_inicio),
      fechaFin: normalizeDateValue(contract.fecha_fin),
      origenManual: contract.origen_manual,
    },
  );
}

function getEditableCoverageMode(
  amparo: EditableAmparo,
  calculation?: ReturnType<typeof normalizeCoverage>,
) {
  if (
    amparo.modo_calculo === "cuantia_fija" ||
    amparo.modo_calculo === "porcentaje_valor_contrato" ||
    amparo.modo_calculo === "valor_asegurado_manual"
  ) {
    return amparo.modo_calculo;
  }

  if (numberOrNull(amparo.cuantia_fija) !== null) {
    return "cuantia_fija";
  }

  if (numberOrNull(amparo.porcentaje) !== null) {
    return "porcentaje_valor_contrato";
  }

  if (numberOrNull(amparo.valor_asegurado) !== null) {
    return "valor_asegurado_manual";
  }

  if (
    calculation?.modo_calculo === "cuantia_fija" ||
    calculation?.modo_calculo === "valor_asegurado_manual"
  ) {
    return calculation.modo_calculo;
  }

  return "porcentaje_valor_contrato";
}

function formatCurrencyInputValue(value: string) {
  const parsed = numberOrNull(value);

  return parsed === null ? value : formatCurrency(parsed);
}

function findSuggestedRate(
  coverageType: string,
  tasasReferencia: TasaReferencia[],
) {
  const normalizedType = normalizeText(coverageType);
  const referencedRate =
    tasasReferencia.find(
      (rate) => normalizeText(rate.tipo_amparo) === normalizedType,
    )?.tasa ?? null;

  return referencedRate ??
    (isCivilLiabilityName(coverageType)
      ? DEFAULT_RCE_RATE
      : DEFAULT_COVERAGE_RATE);
}

function parseSubamparos(value: Amparo["subamparos"]): CoverageSubamparo[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }

      const record = item as Record<string, unknown>;
      const nombre = normalizeTextValue(record.nombre);

      if (!nombre) {
        return null;
      }

      return {
        nombre,
        incluido: normalizeBooleanValue(record.incluido, true),
        porcentaje_sublimite: normalizeNumberValue(
          record.porcentaje_sublimite,
        ),
        valor_sublimite: normalizeNumberValue(record.valor_sublimite),
        origen:
          record.origen === "contrato"
            ? "contrato"
            : "regla_plantilla_afisec",
        calculable: normalizeBooleanValue(record.calculable, false),
        requiere_revision: normalizeBooleanValue(
          record.requiere_revision,
          true,
        ),
        fuente_texto: normalizeTextValue(record.fuente_texto),
        fuente_pagina: normalizeIntegerValue(record.fuente_pagina),
      } satisfies CoverageSubamparo;
    })
    .filter((item): item is CoverageSubamparo => item !== null);
}

function formatPercent(value: number | null | undefined) {
  if (value === null || typeof value === "undefined") {
    return "0";
  }

  return Number((value * 100).toFixed(4)).toString();
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
