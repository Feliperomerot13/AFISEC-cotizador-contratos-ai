-- Base de calculo confirmada para liquidacion de amparos.
-- Migracion no destructiva: conserva valor_contrato y agrega campos opcionales.

alter table public.contratos
  add column if not exists base_calculo_amparos numeric,
  add column if not exists base_calculo_incluye_iva boolean;

comment on column public.contratos.base_calculo_amparos is
  'Valor confirmado por la comercial como base para calcular amparos.';

comment on column public.contratos.base_calculo_incluye_iva is
  'Indica si la base de calculo confirmada incluye IVA. Null significa no determinado.';
