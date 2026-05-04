"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  DEFAULT_IVA_PERCENTAGE,
  DEFAULT_RCE_RATE,
  EXECUTIVES,
} from "@/lib/constants";
import {
  normalizeCoverage,
  type CoverageSubamparo,
} from "@/lib/coverage-calculations";
import type {
  Amparo,
  Cliente,
  Contrato,
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
};

type ContractForm = {
  numero_contrato: string;
  objeto: string;
  tipo_contrato: "" | "estatal" | "particular";
  valor_contrato: string;
  moneda: string;
  fecha_inicio: string;
  fecha_fin: string;
  plazo: string;
  contratante: string;
  contratante_nit: string;
  contratista: string;
  contratista_nit: string;
};

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
  fecha_hasta: string;
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
  moneda: "COP",
  fecha_inicio: "",
  fecha_fin: "",
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
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const applyDetail = useCallback((nextDetail: DetailResponse) => {
    setDetail(nextDetail);
    setForm(contractToForm(nextDetail.contract));
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
            ...form,
            tipo_contrato: form.tipo_contrato || null,
            valor_contrato: numberOrNull(form.valor_contrato),
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
              porcentaje: decimalFromPercent(amparo.porcentaje),
              cuantia_fija: numberOrNull(amparo.cuantia_fija),
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

  return (
    <form onSubmit={onValidate} className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">
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
                className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-100"
              >
                <option value="">Sin dato</option>
                <option value="estatal">Estatal</option>
                <option value="particular">Particular</option>
              </select>
              <SourceBlock source={ai?.tipo_contrato} />
            </label>
            <EditableField
              label="Valor"
              type="number"
              value={form.valor_contrato}
              onChange={(value) => updateForm(setForm, "valor_contrato", value)}
              source={ai?.valor_contrato}
            />
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
              label="Fecha fin"
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
          <label className="mt-5 block space-y-2">
            <span className="text-sm font-medium text-neutral-700">Objeto</span>
            <textarea
              value={form.objeto}
              onChange={(event) => updateForm(setForm, "objeto", event.target.value)}
              rows={4}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-100"
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
              <Metadata label="MIME" value={firstDocument.mime_type} />
              <Metadata
                label="Tamaño"
                value={`${Math.round(firstDocument.size_bytes / 1024)} KB`}
              />
              <Metadata label="Cargado" value={formatDate(firstDocument.fecha_carga)} />
            </dl>
          ) : (
            <p className="mt-4 text-sm text-neutral-500">Sin documento asociado.</p>
          )}
          <div className="mt-6 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <p className="text-sm font-medium text-neutral-700">
              Valor actual
            </p>
            <p className="mt-2 text-xl font-semibold text-neutral-950">
              {formatCurrency(
                numberOrNull(form.valor_contrato),
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
                      label="Porcentaje %"
                      type="number"
                      value={amparo.porcentaje}
                      onChange={(value) => updateAmparo(index, "porcentaje", value)}
                    />
                    <EditableAmparoField
                      label="Valor asegurado"
                      type="number"
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
                        className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-100"
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
                        className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-100"
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
                        className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-100"
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
                      type="number"
                      value={amparo.cuantia_fija}
                      onChange={(value) => updateAmparo(index, "cuantia_fija", value)}
                    />
                    <EditableAmparoField
                      label="Tasa %"
                      type="text"
                      inputMode="decimal"
                      value={amparo.tasa}
                      onChange={(value) => updateAmparo(index, "tasa", value)}
                    />
                    <EditableAmparoField
                      label="Desde"
                      type="date"
                      value={amparo.fecha_desde}
                      onChange={(value) => updateAmparo(index, "fecha_desde", value)}
                    />
                    <EditableAmparoField
                      label="Hasta"
                      type="date"
                      value={amparo.fecha_hasta}
                      onChange={(value) => updateAmparo(index, "fecha_hasta", value)}
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
                        className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-100"
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
                      label="Base cálculo"
                      value={formatCurrency(
                        calculation.valor_base_calculo,
                        form.moneda || "COP",
                      )}
                    />
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

                  {calculation.subamparos.length > 0 ? (
                    <SubcoverageList
                      subamparos={calculation.subamparos}
                      currency={form.moneda || "COP"}
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
                      className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-100"
                    />
                  </label>

                  <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-neutral-600">
                    <ConfidenceBadge confidence={amparo.confianza} />
                    <span>Página {amparo.fuente_pagina || "sin dato"}</span>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={amparo.requiere_revision}
                        onChange={(event) =>
                          updateAmparo(
                            index,
                            "requiere_revision",
                            event.target.checked,
                          )
                        }
                        className="h-4 w-4 rounded border-neutral-300 text-teal-700 focus:ring-teal-600"
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
              className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-100 md:w-72"
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
            disabled={isSaving || detail.contract.estado === "procesando"}
            className="h-11 rounded-lg bg-teal-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
          >
            {isSaving ? "Guardando..." : "Confirmar validación"}
          </button>
        </div>
      </section>
    </form>
  );

  function updateAmparo(
    index: number,
    key: keyof EditableAmparo,
    value: string | boolean,
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

function EditableField({
  label,
  value,
  onChange,
  source,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  source?: SourceMeta;
  type?: "text" | "number" | "date";
}) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium text-neutral-700">{label}</span>
      <input
        type={type}
        step={type === "number" ? "any" : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-100"
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
        className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-100"
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

function SubcoverageList({
  subamparos,
  currency,
}: {
  subamparos: CoverageSubamparo[];
  currency: string;
}) {
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
      <div className="mt-3 flex flex-wrap gap-2">
        {subamparos.map((subamparo) => (
          <div
            key={`${subamparo.nombre}-${subamparo.origen}`}
            className="max-w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-700"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-neutral-900">
                {subamparo.nombre}
              </span>
              <span
                className={
                  subamparo.calculable
                    ? "rounded-full bg-teal-100 px-2 py-0.5 font-semibold text-teal-800"
                    : "rounded-full bg-neutral-200 px-2 py-0.5 font-semibold text-neutral-700"
                }
              >
                {subamparo.calculable ? "calculable" : "informativo"}
              </span>
            </div>
            <p className="mt-1">
              {subamparo.valor_sublimite === null
                ? "Sin sublímite"
                : formatCurrency(subamparo.valor_sublimite, currency)}
              {subamparo.porcentaje_sublimite === null
                ? ""
                : ` · ${formatPercent(subamparo.porcentaje_sublimite)}%`}
            </p>
            <p className="mt-1 text-neutral-500">
              {subamparo.origen === "contrato"
                ? "Dato contractual"
                : "Regla plantilla AFISEC"}
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

function contractToForm(contract: Contrato): ContractForm {
  return {
    numero_contrato: contract.numero_contrato ?? "",
    objeto: contract.objeto ?? "",
    tipo_contrato:
      contract.tipo_contrato === "estatal" || contract.tipo_contrato === "particular"
        ? contract.tipo_contrato
        : "",
    valor_contrato:
      contract.valor_contrato === null ? "" : String(contract.valor_contrato),
    moneda: normalizeCurrencyValue(contract.moneda),
    fecha_inicio: normalizeDateValue(contract.fecha_inicio) ?? "",
    fecha_fin: normalizeDateValue(contract.fecha_fin) ?? "",
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
    fecha_desde: normalizeDateValue(amparo.fecha_desde) ?? "",
    fecha_hasta: normalizeDateValue(amparo.fecha_hasta) ?? "",
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
    fecha_hasta: "",
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
  key: keyof ContractForm,
  value: string,
) {
  setForm((current) => ({ ...current, [key]: value }));
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
  return parts
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .split("Falta tasa para calcular prima.")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function calculateEditableAmparo(amparo: EditableAmparo, contract: ContractForm) {
  return normalizeCoverage(
    {
      tipo_amparo: amparo.tipo_amparo || "Amparo sin clasificar",
      porcentaje: decimalFromPercent(amparo.porcentaje),
      cuantia_fija: numberOrNull(amparo.cuantia_fija),
      valor_asegurado: numberOrNull(amparo.valor_asegurado),
      tasa: decimalFromRatePercent(amparo.tasa),
      tasa_manual: amparo.tasa_manual,
      iva_porcentaje:
        numberOrNull(amparo.iva_porcentaje) ?? DEFAULT_IVA_PERCENTAGE,
      tipo_vigencia: amparo.tipo_vigencia || null,
      base_vigencia: amparo.base_vigencia || null,
      dias_adicionales: integerOrNull(amparo.dias_adicionales),
      fecha_desde: amparo.fecha_desde || null,
      fecha_hasta: amparo.fecha_hasta || null,
      fuente_texto: amparo.fuente_texto || null,
      fuente_pagina: integerOrNull(amparo.fuente_pagina),
      subamparos: amparo.subamparos,
      confianza: amparo.confianza || "baja",
    },
    {
      valorContrato: numberOrNull(contract.valor_contrato),
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

  return referencedRate ?? (isCivilLiabilityType(coverageType) ? DEFAULT_RCE_RATE : null);
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
  return value === null || typeof value === "undefined" ? "" : String(value);
}

function formatPercent(value: number | null | undefined) {
  if (value === null || typeof value === "undefined") {
    return "0";
  }

  return Number((value * 100).toFixed(4)).toString();
}
