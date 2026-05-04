-- Liquidacion de amparos y soporte futuro para otrosies/modificaciones.
-- Ejecutar en Supabase antes de usar la nueva UI de liquidacion.

alter table public.amparos
  add column if not exists modificacion_id uuid,
  add column if not exists valor_base_calculo numeric,
  add column if not exists modo_calculo text,
  add column if not exists dias_vigencia integer,
  add column if not exists iva_porcentaje numeric not null default 0.19,
  add column if not exists prima_neta numeric,
  add column if not exists impuesto numeric,
  add column if not exists prima_total numeric,
  add column if not exists tasa_manual boolean not null default false,
  add column if not exists subamparos jsonb not null default '[]'::jsonb;

create table if not exists public.modificaciones_contractuales (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  documento_id uuid references public.documentos(id) on delete set null,
  numero_modificacion text,
  tipo_modificacion text,
  valor_adicion numeric,
  valor_contrato_acumulado numeric,
  fecha_desde date,
  fecha_hasta date,
  dias_prorroga integer,
  fuente_pagina integer,
  fuente_texto text,
  confianza text,
  requiere_revision boolean not null default true,
  motivo_revision text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

alter table public.amparos
  drop constraint if exists amparos_modificacion_id_fkey;

alter table public.amparos
  add constraint amparos_modificacion_id_fkey
  foreign key (modificacion_id)
  references public.modificaciones_contractuales(id)
  on delete set null;

create index if not exists idx_amparos_modificacion_id
  on public.amparos(modificacion_id);

create index if not exists idx_modificaciones_contractuales_contrato_id
  on public.modificaciones_contractuales(contrato_id);

alter table public.modificaciones_contractuales enable row level security;

-- Mantener sin politicas publicas para respetar el patron del MVP:
-- lecturas y escrituras protegidas pasan por Route Handlers con service role.
