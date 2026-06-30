-- Sprint 4: prima neta manual y eliminacion segura de contratos no emitidos.
-- Migracion no destructiva para datos vigentes. No modifica migraciones previas.

alter table public.amparos
  add column if not exists usar_prima_neta_manual boolean not null default false,
  add column if not exists prima_neta_manual numeric,
  add column if not exists prima_neta_automatica numeric;

update public.amparos
set prima_neta_automatica = prima_neta
where prima_neta_automatica is null
  and prima_neta is not null;

comment on column public.amparos.usar_prima_neta_manual is
  'Indica si la prima neta final fue fijada manualmente durante la revision.';

comment on column public.amparos.prima_neta_manual is
  'Prima neta comercial ingresada manualmente cuando el override esta activo.';

comment on column public.amparos.prima_neta_automatica is
  'Prima neta calculada por valor asegurado, tasa y dias, conservada como referencia.';

create or replace function public.eliminar_contrato_no_emitido(
  p_contrato_id bigint
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_storage_objects jsonb;
begin
  perform 1
  from public.contratos
  where id = p_contrato_id
  for update;

  if not found then
    raise exception 'No se encontro el contrato solicitado.';
  end if;

  if exists (
    select 1
    from public.cotizaciones
    where contrato_id = p_contrato_id
      and (
        fecha_emision is not null
        or estado in ('emitida', 'emision_revertida')
      )
  ) then
    raise exception 'El contrato conserva trazabilidad de una poliza emitida y no puede eliminarse.';
  end if;

  if exists (
    select 1
    from public.cotizaciones_ajuste
    where contrato_id = p_contrato_id
      and (
        fecha_emision is not null
        or estado in ('endoso_emitido', 'emision_revertida')
      )
  ) then
    raise exception 'El contrato conserva trazabilidad de un otrosi emitido y no puede eliminarse.';
  end if;

  if exists (
    select 1
    from public.modificaciones_contractuales
    where contrato_id = p_contrato_id
      and (
        aplicada_en is not null
        or estado in ('endoso_emitido', 'aplicada')
      )
  ) then
    raise exception 'El contrato conserva un estado vigente emitido y no puede eliminarse.';
  end if;

  select coalesce(
    jsonb_agg(
      distinct jsonb_build_object(
        'bucket', storage_file.bucket,
        'path', storage_file.path
      )
    ),
    '[]'::jsonb
  )
  into v_storage_objects
  from (
    select storage_bucket as bucket, storage_path as path
    from public.documentos
    where contrato_id = p_contrato_id

    union all

    select pdf_bucket as bucket, pdf_path as path
    from public.cotizaciones
    where contrato_id = p_contrato_id

    union all

    select pdf_bucket as bucket, pdf_path as path
    from public.cotizaciones_ajuste
    where contrato_id = p_contrato_id
  ) as storage_file
  where storage_file.bucket is not null
    and storage_file.path is not null;

  delete from public.amparos
  where contrato_id = p_contrato_id;

  delete from public.cotizaciones_ajuste
  where contrato_id = p_contrato_id;

  delete from public.modificaciones_contractuales
  where contrato_id = p_contrato_id;

  delete from public.cotizaciones
  where contrato_id = p_contrato_id;

  delete from public.extracciones
  where contrato_id = p_contrato_id;

  delete from public.documentos
  where contrato_id = p_contrato_id;

  delete from public.contratos
  where id = p_contrato_id;

  return jsonb_build_object(
    'contrato_id', p_contrato_id,
    'storage_objects', v_storage_objects
  );
end;
$$;

revoke all on function public.eliminar_contrato_no_emitido(bigint) from public;
revoke all on function public.eliminar_contrato_no_emitido(bigint) from anon;
revoke all on function public.eliminar_contrato_no_emitido(bigint) from authenticated;
grant execute on function public.eliminar_contrato_no_emitido(bigint) to service_role;
