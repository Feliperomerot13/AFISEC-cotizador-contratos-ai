-- Sprint 5: cotizacion manual sin documento. Marca el origen del registro en contratos.
-- Migracion no destructiva. Los contratos existentes quedan con origen 'documento'.

alter table public.contratos
  add column if not exists origen text not null default 'documento';

alter table public.contratos
  drop constraint if exists contratos_origen_check;

alter table public.contratos
  add constraint contratos_origen_check
  check (origen in ('documento', 'manual'));

comment on column public.contratos.origen is
  'documento: creado desde un PDF cargado. manual: creado como Nueva cotizacion sin documento.';
