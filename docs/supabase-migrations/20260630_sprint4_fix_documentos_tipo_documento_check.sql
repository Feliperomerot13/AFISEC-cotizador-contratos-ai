-- Hotfix Sprint 4: alinear documentos.tipo_documento con DOCUMENT_TYPES de la app.
-- Migracion no destructiva. No modifica migraciones previas.

alter table public.documentos
  drop constraint if exists documentos_tipo_documento_check;

alter table public.documentos
  add constraint documentos_tipo_documento_check
  check (
    tipo_documento in (
      'contrato_base',
      'orden',
      'orden_compra',
      'otrosi',
      'otro'
    )
  );

comment on constraint documentos_tipo_documento_check on public.documentos is
  'Valores permitidos alineados con DOCUMENT_TYPES (lib/constants.ts): contrato_base, orden, orden_compra, otrosi. Incluye otro como valor legacy historico.';
