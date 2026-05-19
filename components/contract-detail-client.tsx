"use client";

import {
  Fragment,
  FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  DEFAULT_COVERAGE_RATE,
  DEFAULT_IVA_PERCENTAGE,
  DEFAULT_RCE_RATE,
  EXECUTIVES,
} from "@/lib/constants";
import { addDaysToDateOnly } from "@/lib/date-only";
import {
  normalizeCoverage,
  type CoverageSubamparo,
} from "@/lib/coverage-calculations";
import type {
  Amparo,
  Cliente,
  Contrato,
  Cotizacion,
  Documento,
  TasaReferencia,
} from "@/lib/database.types";
import {
  formatCurrency,
  formatDate,
  normalizeText,
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
  formatCoverageName,
  getQuoteSnapshot,
  quoteStatusLabel,
} from "@/lib/quotes";
import type { QuoteSnapshot, QuoteSnapshotSubcoverage } from "@/lib/quotes";
import type { AIExtraction } from "@/lib/schemas";
import { ConfidenceBadge, StatusBadge } from "@/components/status-badge";

type DocumentMetadata = Omit<Documento, "storage_path">;

type DetailResponse = {
  contract: Contrato;
  client: Cliente;
  documents: DocumentMetadata[];
  amparos: Amparo[];
  tasasReferencia: TasaReferencia[];
  extraction: AIExtraction | null;
  cotizaciones: Cotizacion[];
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
  contratante: string;
  contratante_nit: string;
  contratista: string;
  contratista_nit: string;
};

type EditableContractFormKey = Exclude<keyof ContractForm, "fecha_fin_manual">;

type EditableAmparo = {
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
  dias_adicionales: string;
  dias_vigencia: string;
  prima_neta: string;
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
  contratante: "",
  contratante_nit: "",
  contratista: "",
  contratista_nit: "",
};

export function ContractDetailClient({ contractId }: { contractId: string }) {
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [form, setForm] = useState<ContractForm>(emptyForm);
  const [amparos, setAmparos] = useState<EditableAmparo[]>([]);
  const [validadoPor, setValidadoPor] = useState("Diana");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [quoteAction, setQuoteAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const applyDetail = useCallback((nextDetail: DetailResponse) => {
    setDetail(nextDetail);
    setForm(
      contractToForm(
        nextDetail.contract,
        nextDetail.extraction,
        nextDetail.amparos,
      ),
    );
    setAmparos(
      nextDetail.amparos.map((amparo) =>
        amparoToEditable(amparo, nextDetail.tasasReferencia),
      ),
    );
    setValidadoPor(nextDetail.contract.validado_por ?? "Diana");
  }, []);

  const loadDetail = useCallback(async () => {
    const nextDetail = await fetchContractDetail(contractId);
    applyDetail(nextDetail);
    setError(null);
  }, [applyDetail, contractId]);

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
  const firstDocument = detail?.documents[0] ?? null;
  const startDependsOnActaInicio = contractDependsOnActaInicio(form, ai);

  async function onValidate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
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
              impuesto: calculation.impuesto,
              prima_total: calculation.prima_total,
              tasa_manual: amparo.tasa_manual,
              tipo_vigencia: amparo.tipo_vigencia || null,
              base_vigencia: amparo.base_vigencia || null,
              fecha_desde: calculation.fecha_desde,
              fecha_hasta: calculation.fecha_hasta,
              dias_adicionales: calculation.dias_adicionales,
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
      await loadDetail();
    } catch (saveError) {
      setError(
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

  if (isLoading) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-500 shadow-sm">
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
  const canGenerateQuote =
    detail.contract.estado === "validado" && !isIssuedLocked;

  return (
    <form onSubmit={onValidate} className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#d25b30]">
            Revisión
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-950">
            {detail.client.nombre}
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            NIT {detail.client.nit} · {detail.client.ejecutivo}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge state={detail.contract.estado} />
          <p className="text-sm text-neutral-500">
            Procesado: {formatDate(detail.contract.fecha_procesamiento)}
          </p>
        </div>
      </div>

      {detail.contract.estado === "procesando" || detail.contract.estado === "cargado" ? (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm font-medium text-sky-700">
          La extracción está en curso. Esta página se actualiza cada 3 segundos.
        </div>
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

      <QuotePanel
        quotes={quotes}
        activeIssuedQuote={activeIssuedQuote}
        contractState={detail.contract.estado}
        canGenerateQuote={canGenerateQuote}
        quoteAction={quoteAction}
        onGenerateQuote={onGenerateQuote}
        onEmitQuote={onEmitQuote}
        onRevertQuote={onRevertQuote}
      />

      {activeIssuedQuote ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800">
          La póliza base emitida bloquea la edición directa de datos, amparos,
          tasas, primas y validación. El historial y el PDF siguen disponibles.
        </div>
      ) : null}

      <fieldset
        disabled={isIssuedLocked}
        className="space-y-6 disabled:opacity-70"
      >
      <section className="grid gap-6 lg:grid-cols-[1fr_0.45fr]">
        <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-neutral-950">
            Datos del contrato
          </h2>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <EditableField
              label="Número"
              value={form.numero_contrato}
              onChange={(value) => updateForm(setForm, "numero_contrato", value)}
              source={ai?.numero_contrato}
            />
            <label className="space-y-2">
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
              <SourceBlock source={ai?.tipo_contrato} />
            </label>
            <EditableField
              label="Valor del contrato"
              type="text"
              inputMode="decimal"
              value={formatInputNumber(numberOrNull(form.valor_contrato))}
              onChange={(value) => updateForm(setForm, "valor_contrato", value)}
              source={ai?.valor_contrato}
            />
            <EditableField
              label="Base de cálculo para amparos"
              type="text"
              inputMode="decimal"
              value={formatInputNumber(numberOrNull(form.base_calculo_amparos))}
              onChange={(value) =>
                updateForm(setForm, "base_calculo_amparos", value)
              }
              source={ai?.valor_contrato}
            />
            <label className="space-y-2">
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
              <SourceBlock source={ai?.valor_contrato} />
            </label>
            <EditableField
              label="Moneda"
              value={form.moneda}
              onChange={(value) => updateForm(setForm, "moneda", value)}
              source={ai?.valor_contrato}
            />
            <EditableField
              label="Fecha inicio"
              type="date"
              value={form.fecha_inicio}
              onChange={(value) => updateForm(setForm, "fecha_inicio", value)}
              source={ai?.fecha_inicio}
            />
            <EditableField
              label="Plazo en días"
              type="number"
              value={form.plazo_dias}
              onChange={(value) => updateForm(setForm, "plazo_dias", value)}
              source={ai?.plazo}
            />
            <EditableField
              label="Fecha fin calculada"
              type="date"
              value={form.fecha_fin}
              onChange={(value) => updateForm(setForm, "fecha_fin", value)}
              source={ai?.fecha_fin}
            />
            <EditableField
              label="Plazo"
              value={form.plazo}
              onChange={(value) => updateForm(setForm, "plazo", value)}
              source={ai?.plazo}
            />
          </div>
          {startDependsOnActaInicio ? (
            <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Fecha de inicio depende del Acta de Inicio. Ingrese la fecha
              manualmente para calcular vigencias.
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
          <label className="mt-5 block space-y-2">
            <span className="text-sm font-medium text-neutral-700">Objeto</span>
            <textarea
              value={form.objeto}
              onChange={(event) => updateForm(setForm, "objeto", event.target.value)}
              rows={4}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
            />
            <SourceBlock source={ai?.objeto} />
          </label>
        </div>

        <aside className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-neutral-950">Documento</h2>
          {firstDocument ? (
            <dl className="mt-5 space-y-4 text-sm">
              <Metadata label="Archivo" value={firstDocument.nombre_archivo} />
              <Metadata label="Tipo" value={firstDocument.tipo_documento} />
              <Metadata label="MIME" value={firstDocument.mime_type ?? "Sin dato"} />
              <Metadata
                label="Tamaño"
                value={
                  firstDocument.size_bytes === null
                    ? "Sin dato"
                    : `${Math.round(firstDocument.size_bytes / 1024)} KB`
                }
              />
              <Metadata label="Cargado" value={formatDate(firstDocument.fecha_carga)} />
            </dl>
          ) : (
            <p className="mt-4 text-sm text-neutral-500">Sin documento asociado.</p>
          )}
          <div className="mt-6 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <p className="text-sm font-medium text-neutral-700">
              Base de cálculo
            </p>
            <p className="mt-2 text-xl font-semibold text-neutral-950">
              {formatCurrency(
                getCalculationBase(form),
                form.moneda || "COP",
              )}
            </p>
          </div>
        </aside>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-neutral-950">Partes</h2>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
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
            source={ai?.contratante}
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
            source={ai?.contratista}
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

        <div className="mt-5 space-y-5">
          {amparos.length === 0 ? (
            <p className="text-sm text-neutral-500">No se detectaron amparos.</p>
          ) : (
            amparos.map((amparo, index) => {
              const calculation = calculateEditableAmparo(amparo, form);
              const calculableSubamparo = getCalculableSubamparo(
                calculation.subamparos,
              );
              const isAdvanceCoverage =
                calculation.tipo_amparo === "buen_manejo_anticipo";

              return (
                <div
                  key={amparo.id ?? index}
                  className="rounded-lg border border-neutral-200 bg-neutral-50 p-4"
                >
                  <div className="grid gap-4 md:grid-cols-4">
                    <EditableAmparoField
                      label="Tipo"
                      value={amparo.tipo_amparo}
                      onChange={(value) => updateAmparo(index, "tipo_amparo", value)}
                    />
                    <EditableAmparoField
                      label={isAdvanceCoverage ? "Porcentaje anticipo %" : "Porcentaje %"}
                      type="number"
                      value={
                        isAdvanceCoverage
                          ? percentFromDecimal(calculation.porcentaje)
                          : amparo.porcentaje
                      }
                      onChange={(value) => updateAmparo(index, "porcentaje", value)}
                    />
                    <EditableAmparoField
                      label="Valor asegurado"
                      type="text"
                      inputMode="decimal"
                      value={formatInputNumber(calculation.valor_asegurado)}
                      onChange={(value) =>
                        updateAmparo(index, "valor_asegurado", value)
                      }
                    />
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-neutral-700">
                        Confianza
                      </span>
                      <select
                        value={amparo.confianza}
                        onChange={(event) =>
                          updateAmparo(index, "confianza", event.target.value)
                        }
                        className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
                      >
                        <option value="">Sin dato</option>
                        <option value="alta">alta</option>
                        <option value="media">media</option>
                        <option value="baja">baja</option>
                      </select>
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-neutral-700">
                        Vigencia
                      </span>
                      <select
                        value={amparo.tipo_vigencia}
                        onChange={(event) =>
                          updateAmparo(index, "tipo_vigencia", event.target.value)
                        }
                        className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
                      >
                        <option value="">Sin dato</option>
                        <option value="contractual">Contractual</option>
                        <option value="post_contractual">Post contractual</option>
                      </select>
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-neutral-700">
                        Base vigencia
                      </span>
                      <select
                        value={amparo.base_vigencia}
                        onChange={(event) =>
                          updateAmparo(index, "base_vigencia", event.target.value)
                        }
                        className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
                      >
                        <option value="">Sin dato</option>
                        <option value="fecha_inicio_contrato">
                          Inicio contrato
                        </option>
                        <option value="fecha_fin_contrato">Fin contrato</option>
                        <option value="acta_recibo_final">
                          Acta recibo final
                        </option>
                        <option value="firma_contrato">Firma contrato</option>
                        <option value="otra">Otra</option>
                      </select>
                    </label>
                    <EditableAmparoField
                      label="Cuantía fija"
                      type="text"
                      inputMode="decimal"
                      value={formatInputNumber(numberOrNull(amparo.cuantia_fija))}
                      onChange={(value) => updateAmparo(index, "cuantia_fija", value)}
                    />
                    <EditableAmparoField
                      label="Tasa %"
                      type="text"
                      inputMode="decimal"
                      value={amparo.tasa}
                      onChange={(value) => updateAmparo(index, "tasa", value)}
                    />
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-[0.5fr_1.5fr_auto] md:items-end">
                    <EditableAmparoField
                      label="Días adicionales"
                      type="number"
                      value={amparo.dias_adicionales}
                      onChange={(value) =>
                        updateAmparo(index, "dias_adicionales", value)
                      }
                    />
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-neutral-700">
                        Fuente
                      </span>
                      <textarea
                        value={amparo.fuente_texto}
                        onChange={(event) =>
                          updateAmparo(index, "fuente_texto", event.target.value)
                        }
                        rows={3}
                        className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setAmparos((items) => items.filter((_, itemIndex) => itemIndex !== index))
                      }
                      className="h-10 rounded-lg border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                    >
                      Quitar
                    </button>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-4">
                    {calculableSubamparo ? (
                      <ReadOnlyMetric
                        label="Línea calculable"
                        value={calculableSubamparo.nombre}
                      />
                    ) : null}
                    <ReadOnlyMetric
                      label="Fecha inicio vigencia"
                      value={formatDate(calculation.fecha_desde)}
                    />
                    <ReadOnlyMetric
                      label="Fecha fin contrato/base"
                      value={formatDate(form.fecha_fin)}
                    />
                    <ReadOnlyMetric
                      label="Fecha fin amparo calculada"
                      value={formatDate(calculation.fecha_hasta)}
                    />
                    <ReadOnlyMetric
                      label="Días de vigencia"
                      value={calculation.dias_vigencia?.toString() ?? "Sin dato"}
                    />
                    <ReadOnlyMetric
                      label="Prima neta"
                      value={formatCurrency(
                        calculation.prima_neta,
                        form.moneda || "COP",
                      )}
                    />
                    <ReadOnlyMetric
                      label="IVA"
                      value={formatCurrency(
                        calculation.impuesto,
                        form.moneda || "COP",
                      )}
                    />
                    <ReadOnlyMetric
                      label="Prima total"
                      value={formatCurrency(
                        calculation.prima_total,
                        form.moneda || "COP",
                      )}
                    />
                    <ReadOnlyMetric
                      label={getCoverageBaseLabel(calculation)}
                      value={formatCurrency(
                        getCoverageBaseDisplayValue(calculation),
                        form.moneda || "COP",
                      )}
                    />
                    {isAdvanceCoverage ? (
                      <ReadOnlyMetric
                        label="Criterio base"
                        value={getAdvanceBaseCriterion(calculation, form)}
                      />
                    ) : null}
                    <ReadOnlyMetric
                      label="Modo cálculo"
                      value={calculation.modo_calculo ?? "Sin dato"}
                    />
                    <ReadOnlyMetric
                      label="IVA %"
                      value={`${formatPercent(calculation.iva_porcentaje)}%`}
                    />
                    <ReadOnlyMetric
                      label="Tasa %"
                      value={
                        decimalFromRatePercent(amparo.tasa) === null
                          ? "Sin tasa"
                          : `${formatRatePercent(decimalFromRatePercent(amparo.tasa))}%${amparo.tasa_manual ? " manual" : ""}`
                      }
                    />
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <ManualDateOverride
                      checkboxLabel="Usar fecha inicio manual para este amparo"
                      fieldLabel="Fecha inicio manual"
                      checked={amparo.fecha_desde_manual}
                      value={amparo.fecha_desde}
                      onCheckedChange={(checked) =>
                        updateAmparo(index, "fecha_desde_manual", checked)
                      }
                      onValueChange={(value) =>
                        updateAmparo(index, "fecha_desde", value)
                      }
                    />
                    <ManualDateOverride
                      checkboxLabel="Usar fecha fin manual para este amparo"
                      fieldLabel="Fecha fin manual"
                      checked={amparo.fecha_hasta_manual}
                      value={amparo.fecha_hasta}
                      onCheckedChange={(checked) =>
                        updateAmparo(index, "fecha_hasta_manual", checked)
                      }
                      onValueChange={(value) =>
                        updateAmparo(index, "fecha_hasta", value)
                      }
                    />
                  </div>

                  {calculation.subamparos.length > 0 ? (
                    <SubcoverageEditor
                      subamparos={calculation.subamparos}
                      currency={form.moneda || "COP"}
                      mainInsuredValue={calculation.valor_asegurado}
                      onChange={(nextSubamparos) =>
                        updateAmparo(index, "subamparos", nextSubamparos)
                      }
                    />
                  ) : null}

                  <label className="mt-4 block space-y-2">
                    <span className="text-sm font-medium text-neutral-700">
                      Motivo de revisión
                    </span>
                    <textarea
                      value={mergeReviewReasons(
                        amparo.motivo_revision,
                        calculation.motivo_revision,
                      )}
                      onChange={(event) =>
                        updateAmparo(index, "motivo_revision", event.target.value)
                      }
                      rows={2}
                      className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
                    />
                  </label>

                  <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-neutral-600">
                    <ConfidenceBadge confidence={amparo.confianza} />
                    <span>Página {amparo.fuente_pagina || "sin dato"}</span>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={
                          amparo.requiere_revision ||
                          Boolean(calculation.motivo_revision)
                        }
                        onChange={(event) =>
                          updateAmparo(
                            index,
                            "requiere_revision",
                            event.target.checked,
                          )
                        }
                        className="h-4 w-4 rounded border-neutral-300 text-[#d25b30] focus:ring-[#d25b30]"
                      />
                      Requiere revisión
                    </label>
                  </div>

                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <label className="space-y-2">
            <span className="text-sm font-medium text-neutral-700">
              Validado por
            </span>
            <select
              value={validadoPor}
              onChange={(event) => setValidadoPor(event.target.value)}
              className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15 md:w-72"
            >
              {EXECUTIVES.map((executive) => (
                <option key={executive} value={executive}>
                  {executive}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={isSaving || detail.contract.estado === "procesando" || isIssuedLocked}
            className="h-11 rounded-lg bg-[#d25b30] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#b94d28] disabled:cursor-not-allowed disabled:bg-neutral-400"
          >
            {isIssuedLocked
              ? "Póliza emitida"
              : isSaving
                ? "Guardando..."
                : "Confirmar validación"}
          </button>
        </div>
      </section>
      </fieldset>
    </form>
  );

  function updateAmparo(
    index: number,
    key: keyof EditableAmparo,
    value: string | boolean | CoverageSubamparo[],
  ) {
    setAmparos((items) =>
      items.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [key]: value,
              tasa_manual: key === "tasa" ? true : item.tasa_manual,
            }
          : item,
      ),
    );
  }
}

function QuotePanel({
  quotes,
  activeIssuedQuote,
  contractState,
  canGenerateQuote,
  quoteAction,
  onGenerateQuote,
  onEmitQuote,
  onRevertQuote,
}: {
  quotes: Cotizacion[];
  activeIssuedQuote: Cotizacion | null;
  contractState: string;
  canGenerateQuote: boolean;
  quoteAction: string | null;
  onGenerateQuote: () => void;
  onEmitQuote: (quoteId: string | number) => void;
  onRevertQuote: (quoteId: string | number) => void;
}) {
  const activeSnapshot = activeIssuedQuote
    ? getQuoteSnapshot(activeIssuedQuote)
    : null;
  const referenceQuote = activeIssuedQuote ?? quotes[0] ?? null;
  const referenceSnapshot = referenceQuote
    ? getQuoteSnapshot(referenceQuote)
    : null;

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
        <button
          type="button"
          onClick={onGenerateQuote}
          disabled={!canGenerateQuote || quoteAction !== null}
          className="h-11 rounded-lg bg-[#d25b30] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#b94d28] disabled:cursor-not-allowed disabled:bg-neutral-400"
        >
          {quoteAction === "generate"
            ? "Generando..."
            : contractState !== "validado"
              ? "Validación requerida"
              : activeIssuedQuote
                ? "Póliza emitida"
                : "Generar cotización PDF"}
        </button>
      </div>

      {activeIssuedQuote ? (
        <IssuedPolicySummary quote={activeIssuedQuote} snapshot={activeSnapshot} />
      ) : null}

      <QuotesHistoryTable
        quotes={quotes}
        activeIssuedQuote={activeIssuedQuote}
        quoteAction={quoteAction}
        onEmitQuote={onEmitQuote}
        onRevertQuote={onRevertQuote}
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
}: {
  quotes: Cotizacion[];
  activeIssuedQuote: Cotizacion | null;
  quoteAction: string | null;
  onEmitQuote: (quoteId: string | number) => void;
  onRevertQuote: (quoteId: string | number) => void;
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
            <th className="border-b border-neutral-200 px-3 py-2 text-right">Total</th>
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
                  {formatCurrency(quote.total_prima, currency)}
                </td>
                <td className="px-3 py-3">
                  <div className="flex justify-end gap-2">
                    <a
                      href={`/api/quotes/${quote.id}/download`}
                      className="inline-flex h-9 items-center rounded-lg border border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-800 transition hover:bg-neutral-100"
                    >
                      PDF
                    </a>
                    {quote.estado === "generada" ? (
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
            <TableLabel>Total</TableLabel>
            <TableValue>
              {formatCurrency(
                snapshot?.totales.prima_total ?? quote.total_prima,
                currency,
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

  return (
    <div className="mt-5 overflow-x-auto rounded-lg border border-neutral-200">
      <table className="min-w-[980px] w-full border-collapse text-left text-sm">
        <caption className="bg-neutral-50 px-3 py-2 text-left text-sm font-semibold text-neutral-950">
          {title}: {quote.numero_cotizacion} v{quote.version}
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
          {snapshot.amparos.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-3 py-4 text-sm text-neutral-500">
                No hay amparos cotizados.
              </td>
            </tr>
          ) : (
            snapshot.amparos.map((amparo, index) => {
              const subcoverages = getIncludedSubcoverages(amparo.subamparos);
              const showRceDetail =
                isCivilLiabilityCoverage(amparo.tipo_amparo) &&
                subcoverages.length > 0;

              return (
                <Fragment key={`${amparo.tipo_amparo}-${index}`}>
                  <tr>
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
                  {showRceDetail ? (
                    <tr className="bg-neutral-50">
                      <td
                        colSpan={8}
                        className="px-3 py-2 text-xs leading-5 text-neutral-600"
                      >
                        <span className="font-semibold text-neutral-800">
                          Subamparos incluidos:
                        </span>{" "}
                        {formatSubcoveragesForUi(subcoverages, currency)}
                        <span className="ml-2">
                          Sin prima individual; la prima corresponde a la línea
                          principal RCE/PLO.
                        </span>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })
          )}
        </tbody>
        <tfoot className="bg-neutral-50 text-sm font-semibold text-neutral-950">
          <tr>
            <td colSpan={5} className="border-t border-neutral-200 px-3 py-2 text-right">
              Totales
            </td>
            <td className="border-t border-neutral-200 px-3 py-2 text-right">
              {formatCurrency(snapshot.totales.prima_neta, currency)}
            </td>
            <td className="border-t border-neutral-200 px-3 py-2 text-right">
              {formatCurrency(snapshot.totales.iva, currency)}
            </td>
            <td className="border-t border-neutral-200 px-3 py-2 text-right text-[#d25b30]">
              {formatCurrency(snapshot.totales.prima_total, currency)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function getCivilLiabilitySubcoverages(snapshot: QuoteSnapshot) {
  return snapshot.amparos.flatMap((amparo) =>
    isCivilLiabilityCoverage(amparo.tipo_amparo)
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

function isCivilLiabilityCoverage(value: string) {
  const normalized = normalizeText(value.replace(/_/g, " "));

  return (
    normalized.includes("responsabilidad civil") ||
    normalized.includes("extracontractual") ||
    normalized.includes("plo")
  );
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
  source,
  type = "text",
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  source?: SourceMeta;
  type?: "text" | "number" | "date";
  inputMode?: "decimal" | "numeric";
}) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium text-neutral-700">{label}</span>
      <input
        type={type}
        step={type === "number" ? "any" : undefined}
        inputMode={inputMode}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
      />
      <SourceBlock source={source} />
    </label>
  );
}

function EditableAmparoField({
  label,
  value,
  onChange,
  type = "text",
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number" | "date";
  inputMode?: "decimal" | "numeric";
}) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium text-neutral-700">{label}</span>
      <input
        type={type}
        step={type === "number" ? "any" : undefined}
        inputMode={inputMode}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
      />
    </label>
  );
}

function ReadOnlyMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-semibold text-neutral-900">
        {value}
      </p>
    </div>
  );
}

function ManualDateOverride({
  checkboxLabel,
  fieldLabel,
  checked,
  value,
  onCheckedChange,
  onValueChange,
}: {
  checkboxLabel: string;
  fieldLabel: string;
  checked: boolean;
  value: string;
  onCheckedChange: (checked: boolean) => void;
  onValueChange: (value: string) => void;
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
      <p className="mt-2 text-xs leading-5 text-neutral-500">
        Use esta opción solo si la póliza tiene una vigencia distinta a la del
        contrato.
      </p>
      {checked ? (
        <label className="mt-3 block space-y-2">
          <span className="text-sm font-medium text-neutral-700">
            {fieldLabel}
          </span>
          <input
            type="date"
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
          />
        </label>
      ) : null}
    </div>
  );
}

function SubcoverageEditor({
  subamparos,
  currency,
  mainInsuredValue,
  onChange,
}: {
  subamparos: CoverageSubamparo[];
  currency: string;
  mainInsuredValue: number | null;
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

  return (
    <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-neutral-800">
          Subamparos incluidos
        </p>
        <p className="text-xs font-medium text-neutral-500">
          Solo la línea calculable alimenta la prima
        </p>
      </div>
      <div className="mt-3 space-y-3">
        {subamparos.map((subamparo, index) => (
          <div
            key={`${subamparo.nombre}-${subamparo.origen}`}
            className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={subamparo.incluido}
                  onChange={(event) =>
                    updateSubamparo(index, { incluido: event.target.checked })
                  }
                  className="h-4 w-4 rounded border-neutral-300 text-[#d25b30] focus:ring-[#d25b30]"
                />
                <span className="font-semibold text-neutral-900">
                  {subamparo.nombre}
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={
                    subamparo.calculable
                      ? "rounded-full bg-[#d25b30]/10 px-2 py-0.5 font-semibold text-[#8f3e21]"
                      : "rounded-full bg-neutral-200 px-2 py-0.5 font-semibold text-neutral-700"
                  }
                >
                  {subamparo.calculable ? "calculable" : "informativo"}
                </span>
                <span className="text-neutral-500">
                  {subamparo.origen === "contrato"
                    ? "Dato contractual"
                    : "Regla plantilla AFISEC"}
                </span>
              </div>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="font-medium text-neutral-600">
                  Porcentaje sublímite %
                </span>
                <input
                  type="number"
                  step="any"
                  value={percentFromDecimal(subamparo.porcentaje_sublimite)}
                  onChange={(event) =>
                  {
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
                  disabled={subamparo.calculable}
                  className="h-9 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition disabled:bg-neutral-100 focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
                />
              </label>
              <label className="space-y-1">
                <span className="font-medium text-neutral-600">
                  Valor sublímite
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={formatInputNumber(subamparo.valor_sublimite)}
                  onChange={(event) =>
                    updateSubamparo(index, {
                      valor_sublimite: numberOrNull(event.target.value),
                    })
                  }
                  disabled={subamparo.calculable}
                  className="h-9 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition disabled:bg-neutral-100 focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15"
                />
              </label>
            </div>
            <p className="mt-2 text-neutral-500">
              {subamparo.valor_sublimite === null
                ? "Sin sublímite"
                : formatCurrency(subamparo.valor_sublimite, currency)}
              {subamparo.requiere_revision ? " · revisar" : ""}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SourceBlock({ source }: { source?: SourceMeta }) {
  if (!source) {
    return null;
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ConfidenceBadge confidence={source.confianza} />
        <span className="text-xs font-medium text-neutral-500">
          Página {source.pagina ?? "sin dato"}
        </span>
      </div>
      {source.fuente ? (
        <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-neutral-600">
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
      contract.valor_contrato === null ? "" : String(contract.valor_contrato),
    base_calculo_amparos:
      calculationBase === null ? "" : String(calculationBase),
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
  const hasExplicitDates = amparo.base_vigencia === "fecha_explicita";

  return {
    id: amparo.id,
    tipo_amparo: amparo.tipo_amparo,
    porcentaje: percentFromDecimal(amparo.porcentaje),
    cuantia_fija: amparo.cuantia_fija === null ? "" : String(amparo.cuantia_fija),
    valor_asegurado:
      amparo.valor_asegurado === null ? "" : String(amparo.valor_asegurado),
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
    fecha_desde: hasExplicitDates ? normalizeDateValue(amparo.fecha_desde) ?? "" : "",
    fecha_desde_manual: hasExplicitDates,
    fecha_hasta: hasExplicitDates ? normalizeDateValue(amparo.fecha_hasta) ?? "" : "",
    fecha_hasta_manual: hasExplicitDates,
    dias_adicionales:
      amparo.dias_adicionales === null ? "" : String(amparo.dias_adicionales),
    dias_vigencia:
      amparo.dias_vigencia === null ? "" : String(amparo.dias_vigencia),
    prima_neta: amparo.prima_neta === null ? "" : String(amparo.prima_neta),
    impuesto: amparo.impuesto === null ? "" : String(amparo.impuesto),
    prima_total: amparo.prima_total === null ? "" : String(amparo.prima_total),
    valor_base_calculo:
      amparo.valor_base_calculo === null ? "" : String(amparo.valor_base_calculo),
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
  return {
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
    dias_adicionales: "",
    dias_vigencia: "",
    prima_neta: "",
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
  if (form.fecha_fin_manual && !force) {
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

function normalizeForLooseMatch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function numberOrNull(value: string | number | null | undefined) {
  return normalizeNumberValue(value);
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
  return parsed === null ? null : parsed / 100;
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

function getCoverageBaseLabel(calculation: ReturnType<typeof calculateEditableAmparo>) {
  if (calculation.modo_calculo === "anticipo_100") {
    return "Base anticipo usada";
  }

  if (
    calculation.modo_calculo === "cuantia_fija" &&
    calculation.tipo_amparo === "responsabilidad_civil_extracontractual"
  ) {
    return "Cuantía RCE";
  }

  if (calculation.modo_calculo === "cuantia_fija") {
    return "Cuantía fija";
  }

  if (calculation.modo_calculo === "porcentaje_valor_contrato") {
    return "Valor contrato usado";
  }

  return "Base cálculo";
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
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
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
  ].reduce(
    (current, reason) => current.split(reason).join(" "),
    value,
  );
}

function calculateEditableAmparo(amparo: EditableAmparo, contract: ContractForm) {
  return normalizeCoverage(
    {
      tipo_amparo: amparo.tipo_amparo || "Amparo sin clasificar",
      porcentaje: decimalFromPercent(amparo.porcentaje),
      cuantia_fija: numberOrNull(amparo.cuantia_fija),
      valor_asegurado: numberOrNull(amparo.valor_asegurado),
      valor_base_calculo: numberOrNull(amparo.valor_base_calculo),
      tasa: decimalFromRatePercent(amparo.tasa),
      tasa_manual: amparo.tasa_manual,
      iva_porcentaje:
        numberOrNull(amparo.iva_porcentaje) ?? DEFAULT_IVA_PERCENTAGE,
      tipo_vigencia: amparo.tipo_vigencia || null,
      base_vigencia: amparo.base_vigencia || null,
      dias_adicionales: integerOrNull(amparo.dias_adicionales),
      fecha_desde: amparo.fecha_desde_manual ? amparo.fecha_desde || null : null,
      fecha_hasta: amparo.fecha_hasta_manual ? amparo.fecha_hasta || null : null,
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
    },
  );
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
    (isCivilLiabilityType(coverageType)
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

function getCalculableSubamparo(subamparos: CoverageSubamparo[]) {
  return subamparos.find((subamparo) => subamparo.calculable) ?? null;
}

function isCivilLiabilityType(value: string) {
  const normalized = normalizeText(value);

  return (
    normalized.includes("responsabilidad civil") ||
    normalized.includes("extracontractual") ||
    normalized.includes("plo") ||
    normalized.includes("predios")
  );
}

function formatInputNumber(value: number | null | undefined) {
  if (value === null || typeof value === "undefined" || !Number.isFinite(value)) {
    return "";
  }

  return new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
    useGrouping: true,
  }).format(value);
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
