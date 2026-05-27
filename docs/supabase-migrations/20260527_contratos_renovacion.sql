-- Campo minimo para marcar contratos/polizas con renovacion automatica.
-- No cambia cotizaciones, amparos, otrosies ni calculos existentes.

alter table public.contratos
  add column if not exists renovable_automaticamente boolean not null default false;
