-- AFISEC v0.4.1: resumen IA y persistencia de overrides manuales de fechas.
-- Migracion incremental no destructiva. No modifica datos historicos emitidos.

alter table public.contratos
  add column if not exists resumen_documento_ia text;

comment on column public.contratos.resumen_documento_ia is
  'Resumen contextual generado por IA durante el procesamiento inicial del documento base.';

alter table public.amparos
  add column if not exists fecha_desde_manual boolean not null default false,
  add column if not exists fecha_hasta_manual boolean not null default false;

comment on column public.amparos.fecha_desde_manual is
  'Indica si fecha_desde fue ingresada o fijada manualmente por la revision humana.';

comment on column public.amparos.fecha_hasta_manual is
  'Indica si fecha_hasta fue ingresada o fijada manualmente por la revision humana.';
