"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  amendmentQuoteStatusLabel,
  amendmentStatusLabel,
  getAmendmentQuoteSnapshot,
  jsonToLiquidation,
  normalizeCoverageKey,
  type AmendmentLiquidation,
  type AmendmentQuoteSnapshot,
} from "@/lib/amendments";
import { addDaysToDateOnly, diffDaysDateOnly } from "@/lib/date-only";
import type {
  Amparo,
  Contrato,
  Cotizacion,
  CotizacionAjuste,
  ModificacionContractual,
} from "@/lib/database.types";
import { formatCurrency, formatDate } from "@/lib/format";
import { getQuoteSnapshot } from "@/lib/quotes";

type AmendmentPanelProps = {
  baseQuote: Cotizacion | null;
  contract: Contrato;
  baseAmparos: Amparo[];
  modificaciones: ModificacionContractual[];
  cotizacionesAjuste: CotizacionAjuste[];
  onChanged: () => Promise<void>;
};

type AmendmentForm = {
  numero_modificacion: string;
  tipo_modificacion: string;
  fecha_firma: string;
  valor_contrato_anterior: string;
  valor_adicion: string;
  valor_contrato_acumulado: string;
  fecha_desde: string;
  fecha_hasta: string;
  dias_prorroga: string;
  objeto_nuevo: string;
  requiere_ajuste_garantias: boolean;
  observaciones: string;
  tasas: Record<string, string>;
};

type AmendmentDisplayValues = {
  tipo_modificacion: string | null;
  fecha_firma: string | null;
  valor_contrato_anterior: number | null;
  valor_adicion: number;
  valor_contrato_acumulado: number | null;
  fecha_desde: string | null;
  fecha_hasta: string | null;
  dias_prorroga: number | null;
  objeto_nuevo: string | null;
};

type AmendmentTextFallback = {
  tipoModificacion: string | null;
  fechaFirma: string | null;
  fechaDesde: string | null;
  fechaHasta: string | null;
  diasProrroga: number | null;
  valorAdicion: number | null;
  objetoNuevo: string | null;
};

export function AmendmentsPanel({
  baseQuote,
  contract,
  baseAmparos,
  modificaciones,
  cotizacionesAjuste,
  onChanged,
}: AmendmentPanelProps) {
  const [forms, setForms] = useState<Record<string, AmendmentForm>>(() =>
    Object.fromEntries(
      modificaciones.map((modification) => [
        String(modification.id),
        modificationToForm(modification),
      ]),
    ),
  );
  const [action, setAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const quotesByModification = useMemo(() => {
    const grouped = new Map<string, CotizacionAjuste[]>();

    cotizacionesAjuste.forEach((quote) => {
      const key = String(quote.modificacion_id);
      grouped.set(key, [...(grouped.get(key) ?? []), quote]);
    });

    grouped.forEach((quotes) =>
      quotes.sort((left, right) => right.version - left.version),
    );

    return grouped;
  }, [cotizacionesAjuste]);
  const activeEndorsements = cotizacionesAjuste.filter(
    (quote) => quote.estado === "endoso_emitido",
  );
  const latestActiveEndorsement = [...activeEndorsements]
    .sort(compareAdjustmentQuotesBySequence)
    .at(-1);
  const basePolicyIssues = useMemo(
    () => getBasePolicyUiIssues(baseQuote, contract, baseAmparos),
    [baseQuote, contract, baseAmparos],
  );
  const visibleModifications = useMemo(
    () => modificaciones.filter((modification) => !isHiddenModification(modification)),
    [modificaciones],
  );

  async function runAction(
    actionKey: string,
    request: () => Promise<Response>,
    successMessage: string,
  ) {
    setAction(actionKey);
    setError(null);
    setMessage(null);

    try {
      const response = await request();
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error ?? "No se pudo completar la acción.");
      }

      setMessage(successMessage);
      await onChanged();
      setForms({});
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Ocurrió un error inesperado.",
      );
    } finally {
      setAction(null);
    }
  }

  async function onSaveReview(
    event: FormEvent<HTMLFormElement>,
    modification: ModificacionContractual,
  ) {
    event.preventDefault();
    const form = forms[String(modification.id)] ?? modificationToForm(modification);

    await runAction(
      `review:${modification.id}`,
      () =>
        fetch(`/api/amendments/${modification.id}/review`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            valor_contrato_anterior: numberOrNull(form.valor_contrato_anterior),
            valor_adicion: numberOrNull(form.valor_adicion),
            valor_contrato_acumulado: numberOrNull(
              form.valor_contrato_acumulado,
            ),
            dias_prorroga: integerOrNull(form.dias_prorroga),
            tasas: Object.fromEntries(
              Object.entries(form.tasas).map(([key, value]) => [
                key,
                rateOrNull(value),
              ]),
            ),
          }),
        }),
      "Revisión del otrosí guardada.",
    );
  }

  async function onGenerateQuote(modification: ModificacionContractual) {
    await runAction(
      `quote:${modification.id}`,
      () =>
        fetch(`/api/amendments/${modification.id}/quotes`, {
          method: "POST",
        }),
      "Cotización de ajuste generada.",
    );
  }

  async function onEmitQuote(quote: CotizacionAjuste) {
    await runAction(
      `emit:${quote.id}`,
      () =>
        fetch(`/api/amendment-quotes/${quote.id}/emit`, {
          method: "POST",
        }),
      "Otrosí emitido correctamente.",
    );
  }

  async function onRevertQuote(quote: CotizacionAjuste) {
    const reason = window.prompt(
      "Motivo de reversión de la emisión del otrosí",
      "Reversión operativa del otrosí",
    );

    if (reason === null) {
      return;
    }

    await runAction(
      `revert:${quote.id}`,
      () =>
        fetch(`/api/amendment-quotes/${quote.id}/revert`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ motivo: reason }),
        }),
      "Emisión del otrosí reversada correctamente.",
    );
  }

  async function onDeleteModification(modification: ModificacionContractual) {
    if (
      !window.confirm(
        "¿Eliminar este otrosí? Se ocultará del flujo y no afectará la póliza emitida.",
      )
    ) {
      return;
    }

    await runAction(
      `delete:${modification.id}`,
      () =>
        fetch(`/api/amendments/${modification.id}/close`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            estado: "anulado",
            motivo: "Eliminado antes de emisión",
          }),
        }),
      "Otrosí eliminado.",
    );
  }

  function updateForm(
    modificationId: string | number,
    key: keyof AmendmentForm,
    value: string | boolean | Record<string, string>,
  ) {
    setForms((current) => ({
      ...current,
      [String(modificationId)]: {
        ...(current[String(modificationId)] ??
          modificationToForm(
            modificaciones.find(
              (modification) => String(modification.id) === String(modificationId),
            ) ?? null,
          )),
        [key]: value,
      },
    }));
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#d25b30]">
            Otrosíes
          </p>
          <h2 className="mt-2 text-lg font-semibold text-neutral-950">
            Ajustes sobre póliza emitida
          </h2>
          <p className="mt-2 text-sm text-neutral-500">
            Revisión del delta, cotización de ajuste y emisión de otrosíes en
            orden.
          </p>
        </div>
        <a
          href="/upload"
          className="inline-flex h-10 items-center justify-center rounded-lg border border-neutral-300 bg-white px-4 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-50"
        >
          Cargar otrosí
        </a>
      </div>

      {!baseQuote ? (
        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800">
          Para iniciar otrosíes primero debe existir una póliza base emitida.
        </div>
      ) : null}

      {message ? (
        <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-700">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">
          {error}
        </div>
      ) : null}

      <EndorsementHistoryTable
        baseQuote={baseQuote}
        modificaciones={visibleModifications}
        cotizacionesAjuste={cotizacionesAjuste}
      />

      {basePolicyIssues.length > 0 ? (
        <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-medium leading-6 text-rose-700">
          {basePolicyIssues.join(" ")}
        </div>
      ) : null}

      {visibleModifications.length === 0 ? (
        <p className="mt-5 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-500">
          No hay otrosíes registrados para este contrato.
        </p>
      ) : (
        <div className="mt-6 space-y-6">
          {visibleModifications.map((modification) => {
            const form =
              forms[String(modification.id)] ?? modificationToForm(modification);
            const liquidation = normalizeLiquidationForDisplay(
              jsonToLiquidation(modification.liquidacion),
            );
            const quotes = quotesByModification.get(String(modification.id)) ?? [];
            const isEmitted = modification.estado === "endoso_emitido";
            const hasIssuedTrace = quotes.some((quote) =>
              ["endoso_emitido", "emision_revertida"].includes(quote.estado),
            );
            const canDelete = !isEmitted && !hasIssuedTrace;
            const canGenerateQuote =
              ["validado", "cotizado"].includes(modification.estado) &&
              basePolicyIssues.length === 0;

            return (
              <article
                key={modification.id}
                className="rounded-lg border border-neutral-200 bg-neutral-50 p-4"
              >
                <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
                  <div>
                    <h3 className="text-base font-semibold text-neutral-950">
                      Otrosí {modification.secuencia ?? "-"} ·{" "}
                      {modification.numero_modificacion ?? "Sin número"}
                    </h3>
                    <p className="mt-1 text-sm text-neutral-500">
                      {amendmentStatusLabel(modification.estado)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onGenerateQuote(modification)}
                      disabled={!canGenerateQuote || action !== null}
                      title={basePolicyIssues[0] ?? undefined}
                      className="h-9 rounded-lg bg-[#d25b30] px-3 text-xs font-semibold text-white transition hover:bg-[#b94d28] disabled:cursor-not-allowed disabled:bg-neutral-400"
                    >
                      {action === `quote:${modification.id}`
                        ? "Generando"
                        : "Generar cotización ajuste"}
                    </button>
                    {canDelete ? (
                      <button
                        type="button"
                        onClick={() => onDeleteModification(modification)}
                        disabled={action !== null}
                        className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-800 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400"
                      >
                        Eliminar otrosí
                      </button>
                    ) : null}
                  </div>
                </div>

                <form
                  onSubmit={(event) => onSaveReview(event, modification)}
                  className="mt-4 grid gap-4 md:grid-cols-3"
                >
                  <AmendmentField
                    label="Número de otrosí"
                    value={form.numero_modificacion}
                    disabled={isEmitted}
                    onChange={(value) =>
                      updateForm(modification.id, "numero_modificacion", value)
                    }
                  />
                  <label className="space-y-2 md:col-span-2">
                    <span className="text-sm font-medium text-neutral-700">
                      Tipo
                    </span>
                    <textarea
                      value={form.tipo_modificacion}
                      disabled={isEmitted}
                      onChange={(event) =>
                        updateForm(
                          modification.id,
                          "tipo_modificacion",
                          event.target.value,
                        )
                      }
                      rows={2}
                      className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15 disabled:bg-neutral-100"
                    />
                  </label>
                  <AmendmentField
                    label="Fecha firma"
                    type="date"
                    value={form.fecha_firma}
                    disabled={isEmitted}
                    onChange={(value) =>
                      updateForm(modification.id, "fecha_firma", value)
                    }
                  />
                  <AmendmentField
                    label="Valor anterior"
                    inputMode="decimal"
                    value={formatInputNumber(form.valor_contrato_anterior)}
                    disabled={isEmitted}
                    onChange={(value) =>
                      updateForm(modification.id, "valor_contrato_anterior", value)
                    }
                  />
                  <AmendmentField
                    label="Valor adicionado"
                    inputMode="decimal"
                    value={formatInputNumber(form.valor_adicion)}
                    disabled={isEmitted}
                    onChange={(value) =>
                      updateForm(modification.id, "valor_adicion", value)
                    }
                  />
                  <AmendmentField
                    label="Valor acumulado"
                    inputMode="decimal"
                    value={formatInputNumber(form.valor_contrato_acumulado)}
                    disabled={isEmitted}
                    onChange={(value) =>
                      updateForm(modification.id, "valor_contrato_acumulado", value)
                    }
                  />
                  <AmendmentField
                    label="Fecha fin anterior"
                    type="date"
                    value={form.fecha_desde}
                    disabled={isEmitted}
                    onChange={(value) =>
                      updateForm(modification.id, "fecha_desde", value)
                    }
                  />
                  <AmendmentField
                    label="Nueva fecha fin"
                    type="date"
                    value={form.fecha_hasta}
                    disabled={isEmitted}
                    onChange={(value) =>
                      updateForm(modification.id, "fecha_hasta", value)
                    }
                  />
                  <AmendmentField
                    label="Días de prórroga"
                    type="number"
                    value={form.dias_prorroga}
                    disabled={isEmitted}
                    onChange={(value) =>
                      updateForm(modification.id, "dias_prorroga", value)
                    }
                  />
                  <label className="space-y-2 md:col-span-2">
                    <span className="text-sm font-medium text-neutral-700">
                      Objeto nuevo / ajuste
                    </span>
                    <textarea
                      value={form.objeto_nuevo}
                      disabled={isEmitted}
                      onChange={(event) =>
                        updateForm(
                          modification.id,
                          "objeto_nuevo",
                          event.target.value,
                        )
                      }
                      rows={3}
                      className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15 disabled:bg-neutral-100"
                    />
                  </label>
                  <label className="flex items-center gap-3 self-end rounded-lg border border-neutral-200 bg-white px-3 py-3 text-sm font-medium text-neutral-700">
                    <input
                      type="checkbox"
                      checked={form.requiere_ajuste_garantias}
                      disabled={isEmitted}
                      onChange={(event) =>
                        updateForm(
                          modification.id,
                          "requiere_ajuste_garantias",
                          event.target.checked,
                        )
                      }
                    />
                    Requiere ajuste de garantías
                  </label>
                  <label className="space-y-2 md:col-span-3">
                    <span className="text-sm font-medium text-neutral-700">
                      Observaciones internas de revisión
                    </span>
                    <textarea
                      value={form.observaciones}
                      disabled={isEmitted}
                      onChange={(event) =>
                        updateForm(
                          modification.id,
                          "observaciones",
                          event.target.value,
                        )
                      }
                      rows={2}
                      className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15 disabled:bg-neutral-100"
                    />
                  </label>

                  {liquidation && liquidation.rows.length > 0 ? (
                    <div className="rounded-lg border border-neutral-200 bg-white p-3 md:col-span-3">
                      <p className="text-sm font-semibold text-neutral-950">
                        Tasas internas por amparo
                      </p>
                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        {liquidation.rows.map((row) => {
                          const key = normalizeCoverageKey(row.tipo_amparo);

                          return (
                            <AmendmentField
                              key={key}
                              label={row.nombre_amparo}
                              inputMode="decimal"
                              value={form.tasas[key] ?? ""}
                              disabled={isEmitted}
                              onChange={(value) =>
                                updateForm(modification.id, "tasas", {
                                  ...form.tasas,
                                  [key]: value,
                                })
                              }
                            />
                          );
                        })}
                      </div>
                      <p className="mt-2 text-xs text-neutral-500">
                        Uso interno para recalcular; no se muestra en PDFs
                        comerciales.
                      </p>
                    </div>
                  ) : null}

                  {!isEmitted ? (
                    <div className="md:col-span-3">
                      <button
                        type="submit"
                        disabled={action !== null}
                        className="h-10 rounded-lg bg-neutral-950 px-4 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
                      >
                        {action === `review:${modification.id}`
                          ? "Guardando..."
                          : "Guardar revisión y recalcular"}
                      </button>
                    </div>
                  ) : null}
                </form>

                {liquidation ? (
                  <LiquidationTable
                    liquidation={liquidation}
                    basePolicyIssues={basePolicyIssues}
                  />
                ) : null}

                <AdjustmentQuotesTable
                  quotes={quotes}
                  latestActiveEndorsement={latestActiveEndorsement ?? null}
                  action={action}
                  onEmit={onEmitQuote}
                  onRevert={onRevertQuote}
                />
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function EndorsementHistoryTable({
  baseQuote,
  modificaciones,
  cotizacionesAjuste,
}: {
  baseQuote: Cotizacion | null;
  modificaciones: ModificacionContractual[];
  cotizacionesAjuste: CotizacionAjuste[];
}) {
  const emittedByModification = new Map(
    cotizacionesAjuste
      .filter((quote) => quote.estado === "endoso_emitido")
      .map((quote) => [String(quote.modificacion_id), quote]),
  );
  const baseSnapshot = baseQuote ? getQuoteSnapshot(baseQuote) : null;

  return (
    <div className="mt-5 overflow-x-auto rounded-lg border border-neutral-200">
      <table className="min-w-[980px] w-full border-collapse text-left text-sm">
        <caption className="bg-neutral-50 px-3 py-2 text-left text-sm font-semibold text-neutral-950">
          Histórico de otrosíes
        </caption>
        <thead className="bg-neutral-50 text-xs font-semibold uppercase tracking-[0.08em] text-neutral-500">
          <tr>
            <th className="border-y border-neutral-200 px-3 py-2">Tipo</th>
            <th className="border-y border-neutral-200 px-3 py-2">Número</th>
            <th className="border-y border-neutral-200 px-3 py-2">Fecha</th>
            <th className="border-y border-neutral-200 px-3 py-2 text-right">Valor anterior</th>
            <th className="border-y border-neutral-200 px-3 py-2 text-right">Adición</th>
            <th className="border-y border-neutral-200 px-3 py-2 text-right">Acumulado</th>
            <th className="border-y border-neutral-200 px-3 py-2">Nueva fecha fin</th>
            <th className="border-y border-neutral-200 px-3 py-2 text-right">Prima ajuste</th>
            <th className="border-y border-neutral-200 px-3 py-2">Estado</th>
            <th className="border-y border-neutral-200 px-3 py-2 text-right">PDF</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100 bg-white">
          {baseQuote ? (
            <tr>
              <td className="px-3 py-3 font-semibold text-neutral-950">
                Póliza base
              </td>
              <td className="px-3 py-3">{baseQuote.numero_cotizacion}</td>
              <td className="px-3 py-3">{formatDate(baseQuote.fecha_emision)}</td>
              <td className="px-3 py-3 text-right">-</td>
              <td className="px-3 py-3 text-right">-</td>
              <td className="px-3 py-3 text-right">
                {formatCurrency(
                  baseSnapshot?.contrato.base_calculo_amparos ??
                    baseSnapshot?.contrato.valor_contrato,
                )}
              </td>
              <td className="px-3 py-3">-</td>
              <td className="px-3 py-3 text-right">-</td>
              <td className="px-3 py-3">Emitida</td>
              <td className="px-3 py-3 text-right">
                <a
                  href={`/api/quotes/${baseQuote.id}/download`}
                  className="font-semibold text-[#d25b30]"
                >
                  PDF
                </a>
              </td>
            </tr>
          ) : null}
          {modificaciones.map((modification) => {
            const quote = emittedByModification.get(String(modification.id));
            const liquidation = normalizeLiquidationForDisplay(
              jsonToLiquidation(modification.liquidacion),
            );
            const displayValues = getAmendmentDisplayValues(modification);

            return (
              <tr key={modification.id}>
                <td className="px-3 py-3 font-semibold text-neutral-950">
                  {historyTypeLabel(modification.estado)}
                </td>
                <td className="px-3 py-3">
                  {modification.numero_modificacion ??
                    `Otrosí ${modification.secuencia ?? "-"}`}
                </td>
                <td className="px-3 py-3">{formatDate(displayValues.fecha_firma)}</td>
                <td className="px-3 py-3 text-right">
                  {formatCurrency(displayValues.valor_contrato_anterior)}
                </td>
                <td className="px-3 py-3 text-right">
                  {formatCurrency(displayValues.valor_adicion)}
                </td>
                <td className="px-3 py-3 text-right">
                  {formatCurrency(displayValues.valor_contrato_acumulado)}
                </td>
                <td className="px-3 py-3">{formatDate(displayValues.fecha_hasta)}</td>
                <td className="px-3 py-3 text-right font-semibold text-neutral-950">
                  {formatCurrency(liquidation?.totales.prima_total)}
                </td>
                <td className="px-3 py-3">
                  {amendmentStatusLabel(modification.estado)}
                </td>
                <td className="px-3 py-3 text-right">
                  {quote ? (
                    <a
                      href={`/api/amendment-quotes/${quote.id}/download`}
                      className="font-semibold text-[#d25b30]"
                    >
                      PDF
                    </a>
                  ) : (
                    "Sin PDF"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LiquidationTable({
  liquidation,
  basePolicyIssues,
}: {
  liquidation: AmendmentLiquidation;
  basePolicyIssues: string[];
}) {
  const visibleAlerts = [
    ...basePolicyIssues,
    ...getVisibleLiquidationAlerts(liquidation.alertas),
  ];

  return (
    <div className="mt-5 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
      <table className="min-w-[1120px] w-full border-collapse text-left text-sm">
        <caption className="bg-neutral-50 px-3 py-2 text-left text-sm font-semibold text-neutral-950">
          Liquidación incremental
        </caption>
        <thead className="bg-neutral-50 text-xs font-semibold uppercase tracking-[0.08em] text-neutral-500">
          <tr>
            <th className="border-y border-neutral-200 px-3 py-2">Amparo</th>
            <th className="border-y border-neutral-200 px-3 py-2 text-right">VA vigente</th>
            <th className="border-y border-neutral-200 px-3 py-2 text-right">VA adición</th>
            <th className="border-y border-neutral-200 px-3 py-2 text-right">VA acumulado</th>
            <th className="border-y border-neutral-200 px-3 py-2 text-right">Días adición</th>
            <th className="border-y border-neutral-200 px-3 py-2 text-right">Días prórroga</th>
            <th className="border-y border-neutral-200 px-3 py-2 text-right">Prima por valor adicionado</th>
            <th className="border-y border-neutral-200 px-3 py-2 text-right">Prima por prórroga</th>
            <th className="border-y border-neutral-200 px-3 py-2 text-right">IVA</th>
            <th className="border-y border-neutral-200 px-3 py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {liquidation.rows.map((row) => (
            <tr key={row.tipo_amparo}>
              <td className="px-3 py-3 font-medium text-neutral-950">
                {row.nombre_amparo}
                {row.es_rce && row.subamparos.length > 0 ? (
                  <p className="mt-1 text-xs font-normal leading-5 text-neutral-500">
                    Subamparos informativos:{" "}
                    {row.subamparos
                      .filter((subcoverage) => subcoverage.incluido)
                      .map((subcoverage) => subcoverage.nombre)
                      .join("; ")}
                  </p>
                ) : null}
              </td>
              <td className="px-3 py-3 text-right">
                {formatCurrency(row.valor_asegurado_vigente)}
              </td>
              <td className="px-3 py-3 text-right">
                {formatCurrency(row.valor_asegurado_adicion)}
              </td>
              <td className="px-3 py-3 text-right">
                {formatCurrency(row.valor_asegurado_acumulado)}
              </td>
              <td className="px-3 py-3 text-right">
                {liquidation.valor_adicion > 0 ? row.dias_vigencia_adicion : 0}
              </td>
              <td className="px-3 py-3 text-right">{row.dias_prorroga}</td>
              <td className="px-3 py-3 text-right">
                {formatCurrency(row.prima_valor_adicionado)}
              </td>
              <td className="px-3 py-3 text-right">
                {formatCurrency(row.prima_prorroga)}
              </td>
              <td className="px-3 py-3 text-right">{formatCurrency(row.iva)}</td>
              <td className="px-3 py-3 text-right font-semibold text-neutral-950">
                {formatCurrency(row.prima_total)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-neutral-50 font-semibold text-neutral-950">
          <tr>
            <td colSpan={6} className="border-t border-neutral-200 px-3 py-2 text-right">
              Totales
            </td>
            <td className="border-t border-neutral-200 px-3 py-2 text-right">
              {formatCurrency(liquidation.totales.prima_valor_adicionado)}
            </td>
            <td className="border-t border-neutral-200 px-3 py-2 text-right">
              {formatCurrency(liquidation.totales.prima_prorroga)}
            </td>
            <td className="border-t border-neutral-200 px-3 py-2 text-right">
              {formatCurrency(liquidation.totales.iva)}
            </td>
            <td className="border-t border-neutral-200 px-3 py-2 text-right text-[#d25b30]">
              {formatCurrency(liquidation.totales.prima_total)}
            </td>
          </tr>
        </tfoot>
      </table>
      {visibleAlerts.length > 0 ? (
        <div className="border-t border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
          {visibleAlerts.join(" ")}
        </div>
      ) : null}
    </div>
  );
}

function AdjustmentQuotesTable({
  quotes,
  latestActiveEndorsement,
  action,
  onEmit,
  onRevert,
}: {
  quotes: CotizacionAjuste[];
  latestActiveEndorsement: CotizacionAjuste | null;
  action: string | null;
  onEmit: (quote: CotizacionAjuste) => void;
  onRevert: (quote: CotizacionAjuste) => void;
}) {
  const visibleQuotes = quotes.filter((quote) => quote.estado !== "anulada");

  if (visibleQuotes.length === 0) {
    return (
      <p className="mt-4 rounded-lg border border-dashed border-neutral-300 bg-white p-4 text-sm text-neutral-500">
        Sin cotizaciones de ajuste generadas.
      </p>
    );
  }

  return (
    <div className="mt-5 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
      <table className="min-w-[820px] w-full border-collapse text-left text-sm">
        <caption className="bg-neutral-50 px-3 py-2 text-left text-sm font-semibold text-neutral-950">
          Cotizaciones de ajuste por otrosí
        </caption>
        <thead className="bg-neutral-50 text-xs font-semibold uppercase tracking-[0.08em] text-neutral-500">
          <tr>
            <th className="border-y border-neutral-200 px-3 py-2">Cotización</th>
            <th className="border-y border-neutral-200 px-3 py-2">Versión</th>
            <th className="border-y border-neutral-200 px-3 py-2">Estado</th>
            <th className="border-y border-neutral-200 px-3 py-2">Generada</th>
            <th className="border-y border-neutral-200 px-3 py-2 text-right">Total</th>
            <th className="border-y border-neutral-200 px-3 py-2 text-right">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {visibleQuotes.map((quote) => {
            const snapshot = getAmendmentQuoteSnapshot(quote);
            const canRevert =
              quote.estado === "endoso_emitido" &&
              latestActiveEndorsement &&
              String(latestActiveEndorsement.id) === String(quote.id);

            return (
              <tr key={quote.id}>
                <td className="px-3 py-3 font-semibold text-neutral-950">
                  {quote.numero_cotizacion}
                </td>
                <td className="px-3 py-3">v{quote.version}</td>
                <td className="px-3 py-3">
                  {amendmentQuoteStatusLabel(quote.estado)}
                </td>
                <td className="px-3 py-3">{formatDate(quote.fecha_generacion)}</td>
                <td className="px-3 py-3 text-right font-semibold text-neutral-950">
                  {formatCurrency(
                    quote.total_prima ??
                      snapshot?.liquidacion.totales.prima_total,
                  )}
                </td>
                <td className="px-3 py-3">
                  <div className="flex justify-end gap-2">
                    <a
                      href={`/api/amendment-quotes/${quote.id}/download`}
                      className="inline-flex h-9 items-center rounded-lg border border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-800 transition hover:bg-neutral-100"
                    >
                      PDF
                    </a>
                    {quote.estado === "generada" ? (
                      <button
                        type="button"
                        onClick={() => onEmit(quote)}
                        disabled={action !== null}
                        className="h-9 rounded-lg bg-neutral-950 px-3 text-xs font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
                      >
                        {action === `emit:${quote.id}`
                          ? "Emitiendo"
                          : "Emitir otrosí"}
                      </button>
                    ) : null}
                    {quote.estado === "endoso_emitido" ? (
                      <button
                        type="button"
                        onClick={() => onRevert(quote)}
                        disabled={!canRevert || action !== null}
                        className="h-9 rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400"
                      >
                        {canRevert ? "Reversar emisión" : "Solo último emitido"}
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

function AmendmentField({
  label,
  value,
  onChange,
  disabled,
  type = "text",
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  type?: "text" | "number" | "date";
  inputMode?: "decimal";
}) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium text-neutral-700">{label}</span>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-[#d25b30] focus:ring-4 focus:ring-[#d25b30]/15 disabled:bg-neutral-100"
      />
    </label>
  );
}

function modificationToForm(
  modification: ModificacionContractual | null,
): AmendmentForm {
  if (!modification) {
    return emptyAmendmentForm();
  }

  const liquidation = jsonToLiquidation(modification.liquidacion);
  const displayLiquidation = normalizeLiquidationForDisplay(liquidation);
  const displayValues = getAmendmentDisplayValues(modification);

  return {
    numero_modificacion: modification.numero_modificacion ?? "",
    tipo_modificacion: displayValues.tipo_modificacion ?? "",
    fecha_firma: displayValues.fecha_firma ?? "",
    valor_contrato_anterior: stringFromNumber(displayValues.valor_contrato_anterior),
    valor_adicion: stringFromNumber(displayValues.valor_adicion),
    valor_contrato_acumulado: stringFromNumber(
      displayValues.valor_contrato_acumulado,
    ),
    fecha_desde: displayValues.fecha_desde ?? "",
    fecha_hasta: displayValues.fecha_hasta ?? "",
    dias_prorroga:
      displayValues.dias_prorroga === null
        ? ""
        : String(displayValues.dias_prorroga),
    objeto_nuevo: displayValues.objeto_nuevo ?? "",
    requiere_ajuste_garantias: modification.requiere_ajuste_garantias,
    observaciones: modification.motivo_revision ?? "",
    tasas: Object.fromEntries(
      (displayLiquidation?.rows ?? []).map((row) => [
        normalizeCoverageKey(row.tipo_amparo),
        row.tasa_aplicada === null || typeof row.tasa_aplicada === "undefined"
          ? ""
          : stringFromRate(row.tasa_aplicada),
      ]),
    ),
  };
}

function getAmendmentDisplayValues(
  modification: ModificacionContractual,
): AmendmentDisplayValues {
  const liquidation = normalizeLiquidationForDisplay(
    jsonToLiquidation(modification.liquidacion),
  );
  const fallback = getAmendmentTextFallback(modification);
  const createdDate = modification.creado_en.slice(0, 10);
  const rawFechaDesde =
    modification.fecha_desde ?? liquidation?.fecha_fin_anterior ?? null;
  const rawFechaHasta =
    modification.fecha_hasta ?? liquidation?.nueva_fecha_fin ?? null;
  const shouldPreferFallbackRange = shouldUseFallbackRange({
    fallbackEnd: fallback.fechaHasta,
    fallbackPreviousEnd: fallback.fechaDesde,
    rawEnd: rawFechaHasta,
    rawPreviousEnd: rawFechaDesde,
  });
  const fechaDesde = shouldPreferFallbackRange
    ? fallback.fechaDesde
    : chooseAmendmentDate(rawFechaDesde, fallback.fechaDesde, createdDate);
  const fechaHasta = shouldPreferFallbackRange
    ? fallback.fechaHasta
    : chooseAmendmentDate(rawFechaHasta, fallback.fechaHasta, createdDate);
  const derivedDays =
    fechaDesde && fechaHasta ? diffDaysDateOnly(fechaDesde, fechaHasta) : null;
  const fallbackDays =
    fallback.diasProrroga ??
    derivedDays;

  return {
    tipo_modificacion: chooseAmendmentType(
      modification.tipo_modificacion,
      fallback.tipoModificacion,
    ),
    fecha_firma: chooseAmendmentDate(
      modification.fecha_firma,
      fallback.fechaFirma,
      createdDate,
    ),
    valor_contrato_anterior:
      modification.valor_contrato_anterior ??
      liquidation?.valor_contrato_anterior ??
      null,
    valor_adicion:
      modification.valor_adicion ??
      fallback.valorAdicion ??
      liquidation?.valor_adicion ??
      0,
    valor_contrato_acumulado:
      modification.valor_contrato_acumulado ??
      liquidation?.valor_contrato_acumulado ??
      null,
    fecha_desde: fechaDesde,
    fecha_hasta: fechaHasta,
    dias_prorroga:
      (shouldPreferFallbackRange ? fallbackDays : null) ??
      (derivedDays !== null && derivedDays > 0 ? derivedDays : null) ??
      modification.dias_prorroga ??
      fallback.diasProrroga ??
      liquidation?.dias_prorroga ??
      null,
    objeto_nuevo: modification.objeto_nuevo ?? fallback.objetoNuevo,
  };
}

function chooseAmendmentType(
  currentValue: string | null,
  fallbackValue: string | null,
) {
  if (!fallbackValue) {
    return currentValue;
  }

  const normalized = normalizeForAmendmentSearch(currentValue ?? "");

  if (
    !normalized ||
    normalized === "prorroga" ||
    (fallbackValue.includes("+") && !currentValue?.includes("+"))
  ) {
    return fallbackValue;
  }

  return currentValue;
}

function chooseAmendmentDate(
  currentValue: string | null,
  fallbackValue: string | null,
  createdDate: string,
) {
  if (!fallbackValue) {
    return currentValue;
  }

  if (!currentValue || currentValue === createdDate) {
    return fallbackValue;
  }

  return currentValue;
}

function shouldUseFallbackRange({
  fallbackEnd,
  fallbackPreviousEnd,
  rawEnd,
  rawPreviousEnd,
}: {
  fallbackEnd: string | null;
  fallbackPreviousEnd: string | null;
  rawEnd: string | null;
  rawPreviousEnd: string | null;
}) {
  if (!fallbackPreviousEnd || !fallbackEnd || !rawPreviousEnd || !rawEnd) {
    return false;
  }

  const fallbackDays = diffDaysDateOnly(fallbackPreviousEnd, fallbackEnd);
  const rawDays = diffDaysDateOnly(rawPreviousEnd, rawEnd);

  return (
    fallbackDays !== null &&
    rawDays !== null &&
    fallbackDays > 0 &&
    fallbackDays <= 120 &&
    rawDays > 180
  );
}

function getAmendmentTextFallback(
  modification: ModificacionContractual,
): AmendmentTextFallback {
  const text = [
    modification.fuente_texto,
    modification.motivo_revision,
    ...jsonStrings(modification.alertas),
  ]
    .filter((item): item is string => Boolean(item))
    .join(" ");
  const extensionRange = findExtensionRange(text);
  const days =
    findExtensionDays(text) ??
    (extensionRange
      ? diffDaysDateOnly(extensionRange.previousEnd, extensionRange.end)
      : null);
  const addedValue = findAddedValue(text);
  const noAddedValue = hasNoAddedValueSignal(text);
  const hasAddedValue = addedValue !== null;
  const hasProrroga = hasProrrogaSignal(text);
  const hasObjectChange = hasObjectChangeSignal(text);
  const objectSummary = findObjectChangeSummary(text);

  return {
    tipoModificacion: buildModificationTypeLabel({
      hasAddedValue,
      hasObjectChange,
      hasProrroga,
      noAddedValue,
    }),
    fechaFirma:
      findDocumentSignatureDate(text) ??
      findContextualDate(text, [
        "fecha de firma",
        "firmado",
        "firma",
        "suscrito",
        "suscriben",
        "suscripcion",
      ]) ??
      extensionRange?.previousEnd ??
      null,
    fechaDesde: extensionRange?.previousEnd ?? null,
    fechaHasta: extensionRange?.end ?? null,
    diasProrroga: days,
    valorAdicion: addedValue ?? (noAddedValue ? 0 : null),
    objetoNuevo: objectSummary,
  };
}

function getVisibleLiquidationAlerts(alerts: string[]) {
  return alerts.map((alert) => {
    const normalized = normalizeForAmendmentSearch(alert);

    if (
      normalized.includes("dias de prorroga") &&
      normalized.includes("difieren") &&
      normalized.includes("(0)")
    ) {
      return "No se pudo derivar la prórroga desde las fechas revisadas. Revise fecha fin anterior, nueva fecha fin y días de prórroga antes de emitir.";
    }

    return alert;
  });
}

function getBasePolicyUiIssues(
  baseQuote: Cotizacion | null,
  contract: Contrato,
  baseAmparos: Amparo[],
) {
  if (!baseQuote) {
    return [];
  }

  const snapshot = getQuoteSnapshot(baseQuote);

  if (!snapshot) {
    return ["La póliza base emitida no tiene snapshot válido; revise antes de generar otrosí."];
  }

  const issues: string[] = [];

  if (!snapshot.contrato.fecha_inicio || !snapshot.contrato.fecha_fin) {
    issues.push(
      "La póliza base emitida no tiene vigencia general completa; revise antes de generar otrosí.",
    );
  }

  if (
    contract.fecha_fin &&
    snapshot.contrato.fecha_fin &&
    contract.fecha_fin !== snapshot.contrato.fecha_fin
  ) {
    issues.push(
      `La póliza base emitida tiene fecha fin ${snapshot.contrato.fecha_fin}, pero el contrato vigente registra ${contract.fecha_fin}; revise antes de generar otrosí.`,
    );
  }

  const snapshotRce = snapshot.amparos.filter((coverage) =>
    isCivilLiabilityCoverageKey(coverage.tipo_amparo),
  );
  const liveRce = baseAmparos.filter((coverage) =>
    isCivilLiabilityCoverageKey(coverage.tipo_amparo),
  );

  if (snapshotRce.length > 0 || liveRce.length > 0) {
    const hasIncompleteSnapshotRce =
      snapshotRce.length === 0 ||
      snapshotRce.some(
        (coverage) =>
          !hasPositiveNumber(coverage.valor_asegurado) ||
          !coverage.fecha_desde ||
          !coverage.fecha_hasta ||
          !hasPositiveNumber(coverage.prima_total),
      );
    const hasIncompleteLiveRce = liveRce.some(
      (coverage) =>
        !hasPositiveNumber(coverage.valor_asegurado) ||
        !coverage.fecha_desde ||
        !coverage.fecha_hasta ||
        !hasPositiveNumber(coverage.prima_total),
    );

    if (hasIncompleteSnapshotRce || hasIncompleteLiveRce) {
      issues.push(
        "La póliza base emitida no tiene RCE/PLO completo; revise antes de generar otrosí.",
      );
    }
  }

  return [...new Set(issues)];
}

function hasPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isCivilLiabilityCoverageKey(value: string) {
  const normalized = normalizeCoverageKey(value);

  return (
    normalized.includes("responsabilidad_civil") ||
    normalized.includes("extracontractual") ||
    normalized.includes("rce") ||
    normalized.includes("plo")
  );
}

function historyTypeLabel(status: string) {
  if (status === "endoso_emitido") {
    return "Otrosí emitido";
  }

  if (status === "cotizado") {
    return "Cotización generada";
  }

  if (status === "validado" || status === "pendiente_revision") {
    return "En revisión";
  }

  if (status === "error") {
    return "Error de revisión";
  }

  return "En revisión";
}

function isHiddenModification(modification: ModificacionContractual) {
  return ["anulado", "no_aplicable"].includes(modification.estado);
}

function emptyAmendmentForm(): AmendmentForm {
  return {
    numero_modificacion: "",
    tipo_modificacion: "",
    fecha_firma: "",
    valor_contrato_anterior: "",
    valor_adicion: "",
    valor_contrato_acumulado: "",
    fecha_desde: "",
    fecha_hasta: "",
    dias_prorroga: "",
    objeto_nuevo: "",
    requiere_ajuste_garantias: true,
    observaciones: "",
    tasas: {},
  };
}

function compareAdjustmentQuotesBySequence(
  left: CotizacionAjuste,
  right: CotizacionAjuste,
) {
  const leftSnapshot = getAmendmentQuoteSnapshot(left) as AmendmentQuoteSnapshot | null;
  const rightSnapshot = getAmendmentQuoteSnapshot(right) as AmendmentQuoteSnapshot | null;

  return (
    (leftSnapshot?.modificacion.secuencia ?? 0) -
    (rightSnapshot?.modificacion.secuencia ?? 0)
  );
}

function stringFromNumber(value: number | null) {
  return value === null || !Number.isFinite(value) ? "" : String(value);
}

function stringFromRate(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "";
  }

  return String(normalizeLegacyRate(value));
}

function numberOrNull(value: string) {
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();

  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

function rateOrNull(value: string) {
  const normalized = value
    .replace("%", "")
    .replace(",", ".")
    .trim();

  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? normalizeLegacyRate(parsed) : null;
}

function integerOrNull(value: string) {
  const parsed = numberOrNull(value);

  return parsed === null ? null : Math.round(parsed);
}

function formatInputNumber(value: string) {
  const parsed = numberOrNull(value);

  if (parsed === null) {
    return value;
  }

  return new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(parsed);
}

function normalizeLiquidationForDisplay(
  liquidation: AmendmentLiquidation | null,
): AmendmentLiquidation | null {
  if (!liquidation || !hasLegacyInflatedRate(liquidation)) {
    return liquidation;
  }

  const rows = liquidation.rows.map((row) => ({
    ...row,
    tasa_aplicada: normalizeLegacyRate(row.tasa_aplicada),
    prima_valor_adicionado: row.prima_valor_adicionado / 1000,
    prima_prorroga: row.prima_prorroga / 1000,
    prima_neta: row.prima_neta / 1000,
    iva: row.iva / 1000,
    prima_total: row.prima_total / 1000,
  }));

  return {
    ...liquidation,
    rows,
    totales: {
      prima_valor_adicionado:
        liquidation.totales.prima_valor_adicionado / 1000,
      prima_prorroga: liquidation.totales.prima_prorroga / 1000,
      prima_neta: liquidation.totales.prima_neta / 1000,
      iva: liquidation.totales.iva / 1000,
      prima_total: liquidation.totales.prima_total / 1000,
    },
  };
}

function hasLegacyInflatedRate(liquidation: AmendmentLiquidation) {
  return liquidation.rows.some((row) => row.tasa_aplicada > 1);
}

function normalizeLegacyRate(value: number) {
  return value > 1 ? value / 1000 : value;
}

type DateCandidate = {
  iso: string;
  index: number;
};

function findDocumentSignatureDate(text: string) {
  const candidates = extractDateCandidates(text);
  const signatureCandidates = candidates.filter((candidate) => {
    const before = normalizeForAmendmentSearch(
      text.slice(Math.max(0, candidate.index - 360), candidate.index),
    );

    return (
      (before.includes("para constancia") ||
        before.includes("se suscribe") ||
        before.includes("suscribe por las partes") ||
        before.includes("en la ciudad")) &&
      !before.includes("firmado digitalmente")
    );
  });

  return signatureCandidates.at(-1)?.iso ?? null;
}

function findPreviousEndDate(text: string) {
  const candidates = extractDateCandidates(text);

  for (const candidate of candidates) {
    const before = normalizeForAmendmentSearch(
      text.slice(Math.max(0, candidate.index - 220), candidate.index),
    );

    if (
      (before.includes("plazo de terminacion") ||
        before.includes("fecha de terminacion") ||
        before.includes("fecha fin anterior") ||
        before.includes("terminacion era") ||
        before.includes("terminacion es") ||
        before.includes("vence") ||
        before.includes("vigente hasta")) &&
      !before.includes("nueva fecha") &&
      !before.includes("ampliar") &&
      !before.includes("extiende hasta")
    ) {
      return candidate.iso;
    }
  }

  return null;
}

function findNewEndDate(text: string) {
  const candidates = extractDateCandidates(text);

  for (const candidate of candidates) {
    const before = normalizeForAmendmentSearch(
      text.slice(Math.max(0, candidate.index - 120), candidate.index),
    );
    const segment = normalizeForAmendmentSearch(
      text.slice(Math.max(0, candidate.index - 220), candidate.index + 120),
    );

    if (
      before.includes("hasta") &&
      (segment.includes("ampliar") ||
        segment.includes("amplia") ||
        segment.includes("extiende") ||
        segment.includes("prorroga") ||
        segment.includes("duracion"))
    ) {
      return candidate.iso;
    }
  }

  return null;
}

function findContextualDate(text: string, contextTerms: string[]) {
  const candidates = extractDateCandidates(text);

  for (const candidate of candidates) {
    const windowText = normalizeForAmendmentSearch(
      text.slice(Math.max(0, candidate.index - 180), candidate.index + 180),
    );

    if (contextTerms.some((term) => windowText.includes(term))) {
      return candidate.iso;
    }
  }

  return null;
}

function findExtensionRange(text: string) {
  const previousEndDate = findPreviousEndDate(text);
  const newEndDate = findNewEndDate(text);

  if (
    previousEndDate &&
    newEndDate &&
    diffDaysDateOnly(previousEndDate, newEndDate) !== null &&
    diffDaysDateOnly(previousEndDate, newEndDate)! > 0
  ) {
    return {
      previousEnd: previousEndDate,
      end: newEndDate,
    };
  }

  const candidates = extractDateCandidates(text);
  const explicitDays = findExtensionDays(text);

  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < candidates.length;
      rightIndex += 1
    ) {
      const left = candidates[leftIndex];
      const right = candidates[rightIndex];
      const distance = diffDaysDateOnly(left.iso, right.iso);

      if (distance === null || distance <= 0) {
        continue;
      }

      const segment = normalizeForAmendmentSearch(
        text.slice(
          Math.max(0, left.index - 120),
          Math.min(text.length, right.index + 120),
        ),
      );
      const looksLikeRange =
        hasProrrogaSignal(segment) &&
        segment.includes("hasta") &&
        (segment.includes("desde") ||
          segment.includes("inicio") ||
          segment.includes("inicia") ||
          segment.includes("a partir"));
      const matchesExplicitDays =
        explicitDays !== null &&
        (distance === explicitDays || distance + 1 === explicitDays);

      if (!looksLikeRange && !matchesExplicitDays) {
        continue;
      }

      const previousEnd =
        matchesExplicitDays && distance + 1 === explicitDays
          ? addDaysToDateOnly(left.iso, -1)
          : left.iso;

      return {
        previousEnd: previousEnd ?? left.iso,
        end: right.iso,
      };
    }
  }

  return null;
}

function findExtensionDays(text: string) {
  const normalized = normalizeForAmendmentSearch(text);
  const numericMatch = normalized.match(
    /(?:prorroga|plazo|termino|duracion)[\s\S]{0,80}?(\d{1,3})\s*dias/,
  );

  if (numericMatch) {
    return Number(numericMatch[1]);
  }

  const parenthesizedMatch = normalized.match(/\((\d{1,3})\)\s*dias/);

  if (parenthesizedMatch) {
    return Number(parenthesizedMatch[1]);
  }

  return null;
}

function extractDateCandidates(text: string): DateCandidate[] {
  const candidates: DateCandidate[] = [];
  const numericPattern = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/g;
  const monthNames =
    "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre";
  const monthPattern =
    new RegExp(
      `\\(?\\b(\\d{1,2})\\)?(?:\\s+de)?\\s+(${monthNames})\\s+(?:de\\s+)?(20\\d{2})\\b`,
      "gi",
    );
  const writtenYearMonthPattern = new RegExp(
    `\\(?(\\d{1,2})\\)?\\s+de\\s+(${monthNames})\\s+del?\\s+año\\s+[^()\\d]{0,80}\\((20\\d{2})\\)`,
    "gi",
  );

  function pushCandidate(iso: string | null, index: number) {
    if (
      iso &&
      !candidates.some(
        (candidate) => candidate.iso === iso && candidate.index === index,
      )
    ) {
      candidates.push({ iso, index });
    }
  }

  for (const match of text.matchAll(numericPattern)) {
    pushCandidate(
      toDateOnly(Number(match[3]), Number(match[2]), Number(match[1])),
      match.index ?? 0,
    );
  }

  for (const match of text.matchAll(monthPattern)) {
    const month = monthNumber(match[2]);
    pushCandidate(
      toDateOnly(Number(match[3]), month, Number(match[1])),
      match.index ?? 0,
    );
  }

  for (const match of text.matchAll(writtenYearMonthPattern)) {
    const month = monthNumber(match[2]);
    pushCandidate(
      toDateOnly(Number(match[3]), month, Number(match[1])),
      match.index ?? 0,
    );
  }

  return candidates.sort((left, right) => left.index - right.index);
}

function findAddedValue(text: string) {
  const matches = [
    ...text.matchAll(
      /(?:adiciona|adicionar|adicion|adicionado)[\s\S]{0,240}?\$\s*([\d.,]+)/gi,
    ),
  ];
  const value = matches.at(-1)?.[1] ?? null;

  if (!value) {
    return null;
  }

  const parsed = Number(value.replace(/\./g, "").replace(",", "."));

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toDateOnly(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthNumber(value: string) {
  const normalized = normalizeForAmendmentSearch(value);
  const months: Record<string, number> = {
    enero: 1,
    febrero: 2,
    marzo: 3,
    abril: 4,
    mayo: 5,
    junio: 6,
    julio: 7,
    agosto: 8,
    septiembre: 9,
    setiembre: 9,
    octubre: 10,
    noviembre: 11,
    diciembre: 12,
  };

  return months[normalized] ?? 0;
}

function hasNoAddedValueSignal(text: string) {
  const normalized = normalizeForAmendmentSearch(text);

  return (
    normalized.includes("sin adicion de valor") ||
    normalized.includes("sin adicion") ||
    normalized.includes("no adiciona valor") ||
    normalized.includes("no genera adicion") ||
    normalized.includes("no genera valor adicional")
  );
}

function hasProrrogaSignal(text: string) {
  const normalized = normalizeForAmendmentSearch(text);

  return (
    normalized.includes("prorroga") ||
    normalized.includes("prorrogar") ||
    normalized.includes("plazo") ||
    normalized.includes("termino")
  );
}

function hasObjectChangeSignal(text: string) {
  const normalized = normalizeForAmendmentSearch(text);

  return (
    normalized.includes("modificar la clausula primera") ||
    normalized.includes("modificar el objeto") ||
    normalized.includes("cambio de objeto") ||
    normalized.includes("objeto del contrato") ||
    normalized.includes("utilizando cinco") ||
    normalized.includes("utilizando 5")
  );
}

function findObjectChangeSummary(text: string) {
  const normalized = normalizeForAmendmentSearch(text);

  if (
    (normalized.includes("utilizando cinco") || normalized.includes("utilizando 5")) &&
    (normalized.includes("seis") || normalized.includes("(6)") || normalized.includes("6 gruas"))
  ) {
    return "Prestación del servicio con cinco grúas, en lugar de seis.";
  }

  return null;
}

function buildModificationTypeLabel({
  hasAddedValue,
  hasObjectChange,
  hasProrroga,
  noAddedValue,
}: {
  hasAddedValue: boolean;
  hasObjectChange: boolean;
  hasProrroga: boolean;
  noAddedValue: boolean;
}) {
  if (hasProrroga && noAddedValue && !hasAddedValue && !hasObjectChange) {
    return "Prórroga de plazo sin adición de valor";
  }

  const parts = [
    hasAddedValue ? "Adición de valor" : null,
    hasProrroga ? "prórroga de plazo" : null,
    hasObjectChange ? "cambio de objeto" : null,
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" + ") : null;
}

function normalizeForAmendmentSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function jsonStrings(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  return typeof value === "string" ? [value] : [];
}
