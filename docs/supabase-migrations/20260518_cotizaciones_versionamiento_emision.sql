-- Cotizaciones versionadas y emision de poliza base.
-- Migracion no destructiva: no modifica tablas existentes de extraccion o amparos.

create table if not exists public.cotizaciones (
  id bigserial primary key,
  contrato_id bigint not null references public.contratos(id) on delete cascade,
  numero_cotizacion text not null,
  version integer not null,
  estado text not null default 'generada',
  snapshot jsonb not null,
  total_prima_neta numeric,
  total_iva numeric,
  total_prima numeric,
  pdf_bucket text,
  pdf_path text,
  pdf_nombre_archivo text,
  fecha_generacion timestamptz not null default now(),
  fecha_emision timestamptz,
  fecha_reversion timestamptz,
  motivo_reversion text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint cotizaciones_estado_check check (
    estado in ('generada', 'emitida', 'emision_revertida', 'anulada')
  ),
  constraint cotizaciones_version_positive check (version > 0),
  constraint cotizaciones_contrato_version_unique unique (contrato_id, version)
);

create index if not exists idx_cotizaciones_contrato_id
  on public.cotizaciones(contrato_id);

create unique index if not exists idx_cotizaciones_emision_activa
  on public.cotizaciones(contrato_id)
  where estado = 'emitida';

alter table public.cotizaciones enable row level security;

-- Mantener sin politicas publicas para respetar el patron actual:
-- lecturas y escrituras protegidas pasan por Route Handlers con service role.
