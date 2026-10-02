-- Sprint 5: periodo adicional de vigencia con cantidad y unidad (dias, meses, anios).
-- Migracion no destructiva. dias_adicionales se conserva como equivalente en dias.
-- Las filas existentes quedan con ambas columnas nulas y se interpretan como dias_adicionales en dias.

alter table public.amparos
  add column if not exists periodo_adicional_cantidad integer,
  add column if not exists periodo_adicional_unidad text;

alter table public.amparos
  drop constraint if exists amparos_periodo_adicional_unidad_check;

alter table public.amparos
  add constraint amparos_periodo_adicional_unidad_check
  check (
    periodo_adicional_unidad is null
    or periodo_adicional_unidad in ('dias', 'meses', 'anios')
  );

alter table public.amparos
  drop constraint if exists amparos_periodo_adicional_completo_check;

alter table public.amparos
  add constraint amparos_periodo_adicional_completo_check
  check (
    (periodo_adicional_cantidad is null and periodo_adicional_unidad is null)
    or (
      periodo_adicional_cantidad is not null
      and periodo_adicional_cantidad >= 0
      and periodo_adicional_unidad is not null
    )
  );

comment on column public.amparos.periodo_adicional_cantidad is
  'Cantidad del periodo adicional de vigencia; se interpreta junto con periodo_adicional_unidad.';

comment on column public.amparos.periodo_adicional_unidad is
  'Unidad del periodo adicional: dias, meses o anios. Meses y anios se calculan con aritmetica de calendario.';
