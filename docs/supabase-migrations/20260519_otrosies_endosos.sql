-- Sprint 3: otrosies, cotizaciones de ajuste y endosos.
-- Migracion no destructiva alineada al esquema actual bigint/int8.

do $$
declare
  has_default boolean;
  is_identity boolean;
begin
  select
    a.attidentity <> '',
    d.oid is not null
  into is_identity, has_default
  from pg_attribute a
  left join pg_attrdef d
    on d.adrelid = a.attrelid
   and d.adnum = a.attnum
  where a.attrelid = 'public.modificaciones_contractuales'::regclass
    and a.attname = 'id'
    and not a.attisdropped;

  if coalesce(is_identity, false) = false
     and coalesce(has_default, false) = false then
    create sequence if not exists public.modificaciones_contractuales_id_seq;

    perform setval(
      'public.modificaciones_contractuales_id_seq',
      coalesce((select max(id) from public.modificaciones_contractuales), 1),
      (select max(id) is not null from public.modificaciones_contractuales)
    );

    alter sequence public.modificaciones_contractuales_id_seq
      owned by public.modificaciones_contractuales.id;

    alter table public.modificaciones_contractuales
      alter column id set default nextval('public.modificaciones_contractuales_id_seq'::regclass);
  end if;
end $$;

alter table public.modificaciones_contractuales
  alter column estado set default 'cargado';

alter table public.modificaciones_contractuales
  drop constraint if exists modificaciones_contractuales_estado_check;

alter table public.modificaciones_contractuales
  add constraint modificaciones_contractuales_estado_check check (
    estado in (
      'cargado',
      'procesando',
      'pendiente_revision',
      'validado',
      'cotizado',
      'endoso_emitido',
      'no_aplicable',
      'anulado',
      'error',
      'pendiente_aplicacion',
      'aplicada'
    )
  ) not valid;

alter table public.modificaciones_contractuales
  add column if not exists secuencia integer,
  add column if not exists cotizacion_base_id bigint references public.cotizaciones(id) on delete set null,
  add column if not exists valor_contrato_anterior numeric,
  add column if not exists fecha_firma date,
  add column if not exists objeto_anterior text,
  add column if not exists objeto_nuevo text,
  add column if not exists requiere_ajuste_garantias boolean not null default true,
  add column if not exists liquidacion jsonb not null default '{}'::jsonb,
  add column if not exists snapshot_vigente_anterior jsonb,
  add column if not exists snapshot_vigente_resultante jsonb,
  add column if not exists alertas jsonb not null default '[]'::jsonb,
  add column if not exists campos_no_encontrados jsonb not null default '[]'::jsonb,
  add column if not exists alerta_secuencia text,
  add column if not exists aplicada_en timestamptz,
  add column if not exists aplicado_por text,
  add column if not exists fecha_anulacion timestamptz,
  add column if not exists motivo_anulacion text;

create table if not exists public.cotizaciones_ajuste (
  id bigserial primary key,
  contrato_id bigint not null references public.contratos(id) on delete cascade,
  modificacion_id bigint not null references public.modificaciones_contractuales(id) on delete cascade,
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
  constraint cotizaciones_ajuste_estado_check check (
    estado in ('generada', 'endoso_emitido', 'emision_revertida', 'anulada')
  ),
  constraint cotizaciones_ajuste_version_positive check (version > 0),
  constraint cotizaciones_ajuste_modificacion_version_unique unique (modificacion_id, version)
);

alter table public.modificaciones_contractuales
  add column if not exists endoso_anterior_id bigint references public.cotizaciones_ajuste(id) on delete set null;

create index if not exists idx_modificaciones_contractuales_contrato_secuencia
  on public.modificaciones_contractuales(contrato_id, secuencia);

drop index if exists public.idx_modificaciones_contractuales_pendiente_por_contrato;

create unique index if not exists idx_modificaciones_contractuales_pendiente_por_contrato
  on public.modificaciones_contractuales(contrato_id)
  where estado in ('cargado', 'procesando', 'pendiente_revision', 'validado', 'cotizado', 'error', 'pendiente_aplicacion');

create index if not exists idx_cotizaciones_ajuste_contrato_id
  on public.cotizaciones_ajuste(contrato_id);

create index if not exists idx_cotizaciones_ajuste_modificacion_id
  on public.cotizaciones_ajuste(modificacion_id);

create unique index if not exists idx_cotizaciones_ajuste_endoso_activo_por_modificacion
  on public.cotizaciones_ajuste(modificacion_id)
  where estado = 'endoso_emitido';

alter table public.cotizaciones_ajuste enable row level security;

-- Mantener sin politicas publicas para respetar el patron actual:
-- lecturas y escrituras protegidas pasan por Route Handlers con service role.
