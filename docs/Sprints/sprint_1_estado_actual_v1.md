# Sprint 1: Estado actual, auditoría de limpieza y preparación para Sprint 2

## 1. Resumen ejecutivo

El repositorio está en un estado funcional estable para la V1 de revisión de contratos: permite cargar PDFs, procesarlos con Azure Document Intelligence y Azure OpenAI, guardar extracción estructurada, revisar datos generales, recalcular amparos, editar tasas y confirmar validación humana.

No se encontraron errores de lint ni de las pruebas existentes:

- `npm run lint`: exitoso.
- `npm test`: exitoso. Ejecuta validaciones de normalizadores y cálculo de amparos.
- No se ejecutó `npm run build`.

La alerta principal antes del Sprint 2 es que el repositorio no está completamente limpio de otrosíes. Hay lógica activa para cargar documentos tipo `otrosi`, extraerlos con IA, guardarlos en `modificaciones_contractuales` e insertar amparos con `modificacion_id`. Esto contradice la regla de negocio actual: los otrosíes solo deberían operar después sobre una póliza emitida y no forman parte del Sprint 2.

Recomendación ejecutiva: **B. Conviene hacer una micro-limpieza antes del Sprint 2**, centrada en aislar o deshabilitar el flujo activo de otrosíes antes de implementar cotización, versionamiento y emisión.

Nota de ruta: el repositorio versiona el directorio como `docs/Sprints/`, aunque en este sistema `docs/sprints/` resuelve al mismo lugar. Este archivo fue creado en el directorio existente.

## 2. Estado funcional actual

La aplicación actual funciona como una herramienta interna de prelectura y revisión comercial de contratos para AFISEC.

Capacidades construidas:

- Dashboard inicial con conteos de contratos, pendientes de validación, errores y vencimientos próximos.
- Carga de PDF asociado a cliente, NIT y ejecutiva.
- Creación o reutilización de cliente por NIT.
- Creación de contrato en estado `cargado`.
- Subida de PDF a Supabase Storage.
- Registro de documento en Supabase.
- Procesamiento IA con extracción de texto página por página.
- Extracción estructurada con Azure OpenAI y validación Zod.
- Log de extracciones, alertas, campos no encontrados, tokens y errores.
- Fallback de extracción cuando faltan campos críticos o hay baja confianza.
- Mapeo determinístico de datos de contrato.
- Cálculo determinístico de amparos.
- Revisión humana en pantalla de detalle.
- Edición de datos generales, partes, base de cálculo, fechas, amparos, subamparos y tasas.
- Validación final del contrato con reemplazo de amparos.

Casos soportados por la lógica actual:

- Contratos base.
- Órdenes de compra u órdenes de servicio tratadas como base contractual, siempre que se carguen como documento base u otro.
- Plazos dependientes de Acta de Inicio, con alerta y fechas manuales.
- Vigencias dependientes de Acta de Recibo Final, usando fecha fin como estimación para cotización y marcando revisión.
- Base de cálculo de amparos editable.
- Base con IVA, sin IVA o no determinada.
- Buen manejo de anticipo.
- Responsabilidad Civil Extracontractual como amparo principal con PLO calculable y subamparos informativos.
- Calidad del servicio y vigencias postcontractuales.

No existe aún:

- Cotización PDF.
- Versionamiento documental de cotizaciones.
- Estado de póliza emitida.
- Bloqueo por emisión.
- Snapshot de valores cotizados o emitidos.
- Tablas de cotizaciones o emisión en migraciones.
- Cúmulo, cupos, autenticación o integración con aseguradoras.

## 3. Flujo principal de la aplicación

Flujo nominal:

1. La ejecutiva entra a `/upload`.
2. Selecciona tipo de documento, cliente, NIT, ejecutiva y PDF.
3. El cliente llama `POST /api/upload`.
4. El backend valida formulario y PDF.
5. Para contrato base u otro, el backend crea o reutiliza cliente, crea contrato, sube el PDF y registra documento.
6. El cliente llama `POST /api/contracts/[id]/process`.
7. El backend marca el contrato como `procesando`.
8. `lib/processing.ts` descarga el PDF desde Storage.
9. `lib/ai.ts` extrae texto por página con Azure Document Intelligence.
10. Se construye contexto para OpenAI priorizando páginas relevantes si el documento es largo.
11. Azure OpenAI devuelve JSON estructurado.
12. `lib/schemas.ts` valida la respuesta.
13. `lib/processing.ts` registra la extracción en `extracciones`.
14. Si faltan campos críticos o hay baja confianza, intenta fallback con otro deployment.
15. Se actualiza `contratos` y se reemplazan `amparos`.
16. El contrato queda en `pendiente_validacion`.
17. La pantalla `/contratos/[id]` permite revisar y corregir.
18. El usuario confirma validación.
19. `PUT /api/contracts/[id]/validate` guarda contrato y amparos recalculados.
20. El contrato queda en `validado`.

Pantallas principales:

- `/`: dashboard operativo.
- `/upload`: carga de documentos.
- `/contratos`: listado con filtros simples.
- `/contratos/[id]`: detalle, revisión y validación.

La pantalla de detalle es el centro funcional del sistema. Contiene carga de datos, polling de estado, formulario editable, cálculo previo de amparos, edición de subamparos y envío de validación.

## 4. Rutas API

| Ruta | Método | Uso actual | Observación |
| --- | --- | --- | --- |
| `/api/dashboard` | `GET` | Indicadores de inicio: total, pendientes, errores y vencimientos próximos. | Activa y usada por `dashboard-client.tsx`. |
| `/api/upload` | `POST` | Carga PDF, crea/reusa cliente, crea contrato o registra documento. | Activa. Contiene rama funcional para `otrosi`; es remanente probable. |
| `/api/contracts` | `GET` | Lista contratos con filtros por ejecutiva, estado, búsqueda y vencimiento a 30 días. | Activa y usada por lista y carga de otrosí. |
| `/api/contracts/[id]` | `GET` | Devuelve contrato, cliente, documentos, amparos, tasas relevantes y última extracción. | Activa y usada por detalle. No devuelve `storage_path`, correcto por seguridad. |
| `/api/contracts/[id]/process` | `POST` | Inicia procesamiento IA. Usa `waitUntil` en Vercel y síncrono en local. | Activa. Delega a `processContract`. |
| `/api/contracts/[id]/status` | `GET` | Polling de estado mientras está `cargado`, `procesando` o `procesado_ia`. | Activa y usada por detalle. |
| `/api/contracts/[id]/validate` | `PUT` | Guarda revisión humana, borra e inserta amparos, deja contrato en `validado`. | Activa y crítica. No tocar sin pruebas. |

No se encontraron rutas API huérfanas. Todas tienen consumidor claro o rol de backend claro.

Rutas sospechosas por alcance:

- No hay ruta exclusiva de otrosíes, pero `/api/upload` y `/api/contracts/[id]/process` activan flujo de otrosí si el documento tiene `tipo_documento = "otrosi"`.
- No hay rutas de cotización, emisión, PDF, cúmulo ni cupos, lo cual es esperado antes del Sprint 2.

## 5. Componentes principales

| Componente | Responsabilidad | Estado |
| --- | --- | --- |
| `components/dashboard-client.tsx` | Dashboard inicial, fetch de `/api/dashboard`, cards de indicadores y accesos a carga/listado. | Activo, simple. |
| `components/upload-form.tsx` | Formulario de carga, selección de tipo de documento, envío a `/api/upload` y arranque de procesamiento. | Activo. Contiene UI funcional de otrosí; remanente probable. |
| `components/contracts-list.tsx` | Filtros y listado de contratos. | Activo. Sin señales fuertes de remanente. |
| `components/contract-detail-client.tsx` | Detalle de contrato, polling, edición, cálculo en cliente, subamparos y validación. | Activo y crítico. Muy grande; riesgo alto de cambios accidentales. |
| `components/status-badge.tsx` | Badges de estado y confianza. | Activo, reutilizable. |

Componentes sospechosos, duplicados o huérfanos:

- No hay componentes huérfanos evidentes.
- `components/upload-form.tsx` conserva el flujo visual de otrosíes: selector de tipo, cliente existente y contrato base afectado.
- `components/contract-detail-client.tsx` tiene 1.831 líneas y mezcla UI con muchos helpers locales de fechas, porcentajes, parsing y cálculo editable. No está roto, pero es un punto de riesgo para Sprint 2.
- Los SVGs por defecto de Next en `public/` (`next.svg`, `vercel.svg`, `file.svg`, `globe.svg`, `window.svg`) están versionados y no parecen referenciados. Pueden esperar.

## 6. Helpers y lógica interna

Helpers principales:

- `lib/api.ts`: respuestas JSON sin cache, errores y extracción de mensaje.
- `lib/constants.ts`: ejecutivas, tipos de documento, estados, bucket, versión de prompt y tasas por defecto.
- `lib/env.ts`: validación de variables de entorno server-side.
- `lib/supabase-admin.ts`: cliente Supabase con service role.
- `lib/date-only.ts`: parseo, suma, diferencia y formato de fechas date-only en UTC.
- `lib/format.ts`: formato de moneda, fecha, labels de estado y helpers de porcentaje/texto para UI.
- `lib/normalizers.ts`: normalización robusta de strings, números, fechas, moneda, booleanos y enums desde IA/formularios.
- `lib/schemas.ts`: esquemas Zod para extracción IA, extracción de otrosí, upload, validación y filtros.
- `lib/ai.ts`: Azure Document Intelligence, selección de contexto, prompts y extracción estructurada.
- `lib/processing.ts`: orquestación del pipeline, fallback, mapeo a contrato/amparos, logs y errores.
- `lib/coverage-calculations.ts`: cálculo determinístico de amparos, RCE/PLO, anticipo, fechas, primas y motivos de revisión.
- `lib/database.types.ts`: tipos esperados de Supabase.

Lógica duplicada o dispersa:

- Hay dos helpers llamados `normalizeText`: uno en `lib/normalizers.ts` para normalización de datos y otro en `lib/format.ts` para búsqueda/comparación. No es un bug, pero puede confundir durante Sprint 2.
- Hay parseo de números, porcentajes y fechas repartido entre `contract-detail-client.tsx`, `coverage-calculations.ts`, `processing.ts` y `normalizers.ts`.
- La lógica de anticipo aparece en `processing.ts` y `coverage-calculations.ts`. Parece intencional: una parte extrae señales globales y otra calcula. Aun así, es zona sensible.
- La lógica de RCE/PLO también aparece en `processing.ts` y `coverage-calculations.ts`. Parece intencional, pero requiere no tocarla en Sprint 2 salvo necesidad justificada.
- `contract-detail-client.tsx` recalcula amparos antes de persistir y `validate/route.ts` recalcula de nuevo antes de insertar. Esta doble frontera protege datos, pero puede sorprender si se agregan snapshots de cotización.

## 7. Migraciones y modelo de datos

Migraciones en `docs/supabase-migrations`:

1. `20260504_amparos_liquidacion_modificaciones.sql`
   - Agrega campos de liquidación a `amparos`.
   - Agrega `amparos.modificacion_id`.
   - Crea `modificaciones_contractuales`.
   - Agrega índices y RLS sin políticas públicas.
   - Está alineada con el código actual, pero contiene soporte activo/futuro de otrosíes.

2. `20260511_contratos_base_calculo_amparos.sql`
   - Agrega `contratos.base_calculo_amparos`.
   - Agrega `contratos.base_calculo_incluye_iva`.
   - Está alineada con UI y cálculo actual.

Observaciones:

- No hay migración base completa para crear `clientes`, `contratos`, `documentos`, `amparos`, `extracciones` y `tasas_referencia`. El repo asume que el esquema base ya existe en Supabase.
- No hay migraciones para cotizaciones, PDFs, versiones, emisión, snapshots o bloqueo. Esto es esperado antes del Sprint 2.
- La migración `20260504` es la más sospechosa por el objetivo actual, porque mezcla liquidación de amparos necesaria con soporte de modificaciones/otrosíes.
- `modificaciones_contractuales` y `amparos.modificacion_id` están reflejados en tipos y código. Si existen ya en producción, quitarlos sin plan sería riesgoso; si no existen, el flujo activo de otrosí fallaría al usarse.

Tipos de base de datos:

- `lib/database.types.ts` está alineado con las tablas que el código consulta: `clientes`, `contratos`, `documentos`, `amparos`, `extracciones`, `modificaciones_contractuales` y `tasas_referencia`.
- Incluye `base_calculo_amparos`, `base_calculo_incluye_iva`, campos de prima y `subamparos`.
- Incluye `modificaciones_contractuales` y `amparos.modificacion_id`, lo que confirma que el remanente de otrosí está integrado al modelo tipado.
- No hay tipos para cotizaciones ni emisión, coherente con que Sprint 2 aún no está implementado.
- No se regeneraron tipos.

## 8. Dependencias

Dependencias principales:

- `next@16.2.4`, `react@19.2.4`, `react-dom@19.2.4`: app Next con App Router.
- `@supabase/supabase-js`: base de datos y Storage.
- `@azure-rest/ai-document-intelligence` y `@azure/core-auth`: extracción de texto de PDF.
- `openai`: Azure OpenAI y structured outputs.
- `zod`: validación estricta de payloads e IA.
- `@vercel/functions`: `waitUntil` para procesamiento en Vercel.
- `tailwindcss@4` y `@tailwindcss/postcss`: estilos.
- `eslint`, `eslint-config-next`, `typescript`: calidad y tipado.

No se detectaron dependencias claramente innecesarias para el estado actual.

Observaciones para Sprint 2:

- No hay librería de generación PDF instalada. Es correcto antes de implementar, pero Sprint 2 deberá decidir entre una dependencia nueva o generación server-side con APIs disponibles.
- No hay dependencia específica de emails, autenticación, colas o reportes.
- No se instalaron ni removieron dependencias durante esta auditoría.

## 9. Revisión de remanentes del sprint fallido de otrosíes

Búsquedas realizadas para:

- `otrosi`
- `otrosí`
- `amendment`
- `amendments`
- `modificaciones_contractuales`
- `amendment-calculations`
- `histórico contractual`
- `historico contractual`
- `apply modification`
- `modificación` / `modificaciones`

Hallazgos clasificados:

| Hallazgo | Clasificación | Comentario |
| --- | --- | --- |
| `lib/constants.ts` incluye `DOCUMENT_TYPES = ["contrato_base", "otrosi", "otro"]`. | Remanente probable | Habilita flujo de otrosí desde UI y schema. |
| `components/upload-form.tsx` muestra “Cargar otrosí”, cliente, contrato base afectado y campos ocultos. | Remanente probable | Permite iniciar otrosí antes de emisión. |
| `app/api/upload/route.ts` tiene rama `input.tipoDocumento === "otrosi"`, guarda en carpeta `otrosies` y registra documento contra contrato base. | Remanente probable | Es funcional, no solo texto muerto. |
| `lib/schemas.ts` define `amendmentExtractionSchema` y tipo `AmendmentExtraction`. | Remanente probable | Usado por IA/procesamiento de otrosí. |
| `lib/ai.ts` define prompt y función `extractStructuredAmendment`. | Remanente probable | Activo si se procesa un documento tipo `otrosi`. |
| `lib/processing.ts` importa `extractStructuredAmendment`, decide por `documento.tipo_documento === "otrosi"`, guarda `modificaciones_contractuales` e inserta amparos con `modificacion_id`. | Remanente probable crítico | Mezcla procesamiento de contrato base y modificación contractual. |
| `docs/supabase-migrations/20260504_amparos_liquidacion_modificaciones.sql` crea `modificaciones_contractuales` y `amparos.modificacion_id`. | Sospechoso pero no concluyente | Parte de la migración también es necesaria para liquidación actual. |
| `lib/database.types.ts` incluye tabla `modificaciones_contractuales` y `amparos.modificacion_id`. | Sospechoso pero no concluyente | Alineado con código actual, pero confirma integración de otrosí al modelo. |
| `app/api/contracts/[id]/validate/route.ts` inserta `modificacion_id: null` al validar amparos base. | Necesario para estado actual si la columna existe | No implementa otrosí por sí solo; mantiene amparos base sin modificación. |
| `README.md` y `docs/ARCHITECTURE.md` documentan flujo de otrosíes como existente. | Remanente probable documental | Contradice la regla actual del Sprint 2. |
| `docs/Sprints/sprint_2_cotizacion_emision_afisec.md` menciona otrosíes como fuera de alcance y futuro posterior a emisión. | Necesario para estado actual | Es documentación correcta del objetivo de negocio. |
| `amendment-calculations`, `apply modification`, rutas dedicadas de otrosíes o componentes dedicados fuera de `upload-form`. | No encontrado | No hay módulo con ese nombre ni ruta exclusiva. |
| `histórico contractual` / `historico contractual`. | No encontrado como implementación | Solo hay menciones conceptuales de histórico futuro en documentación. |

Conclusión de remanentes:

El intento de otrosíes no quedó totalmente revertido. No se ve como archivo huérfano aislado, sino como flujo activo embebido en carga, schema, IA, procesamiento, migración, tipos y documentación. Para Sprint 2 esto es el riesgo principal.

## 10. Riesgos antes del Sprint 2

Riesgos para cotización PDF:

- No existe estructura de snapshot. El detalle actual siempre lee datos vivos de `contratos` y `amparos`.
- La pantalla de detalle muestra tasas, fuentes, confianza y motivos; el PDF debe excluir esos datos internos.
- El cálculo de totales existe por amparo, pero no hay helper de totalización comercial de cotización.
- No hay librería PDF ni decisión técnica documentada.

Riesgos para versionamiento:

- Validar hoy reemplaza todos los amparos del contrato. Si una cotización apunta a datos vivos, versiones anteriores podrían cambiar silenciosamente.
- Debe crearse versión solo al generar PDF, no al validar.
- No hay tabla ni estado para cotizaciones.
- `version_prompt` ya existe, pero no debe confundirse con versión de cotización.

Riesgos para emisión/bloqueo:

- `validado` sigue siendo editable. No hay estado `emitida`.
- `PUT /api/contracts/[id]/validate` no distingue póliza emitida de borrador validado.
- No hay snapshot emitido ni relación a cotización emitida.
- El flujo activo de otrosíes permite modificar un contrato base sin exigir póliza emitida.

Riesgos para UI institucional:

- UI ya usa colores AFISEC provisionales, pero no hay logo institucional en `public/`.
- `README.md` y `docs/ARCHITECTURE.md` conservan lenguaje “Muñeco Digital” y “MVP”.
- Hay assets default de Next en `public/` no usados.
- La pantalla de detalle es densa y puede volverse más frágil si se le agregan cotizaciones y emisión sin separar vistas.

Riesgos de tocar lógica que ya funciona:

- `lib/coverage-calculations.ts` cubre casos sensibles: anticipo, RCE/PLO, acta de recibo final, salarios, calidad del servicio y fechas. No conviene tocarlo para PDF salvo lectura de resultados.
- `lib/processing.ts` concentra extracción, fallback, normalización, logs y remanentes de otrosí. Cambios amplios pueden romper carga/procesamiento.
- `components/contract-detail-client.tsx` recalcula en cliente y persiste. Agregar estados visuales de emisión ahí sin cuidado puede afectar validación actual.
- `validate/route.ts` borra e inserta amparos. Cualquier snapshot de cotización debe evitar depender solo de estas filas vivas.

## 11. Archivos críticos que no se deben tocar sin justificación

No recomiendo tocar durante Sprint 2 salvo necesidad justificada y pruebas específicas:

- `lib/ai.ts`: extracción IA, prompts y Document Intelligence.
- `lib/processing.ts`: pipeline de extracción, fallback, mapping y guardado.
- `lib/coverage-calculations.ts`: cálculo de amparos, RCE/PLO, anticipo, primas y fechas.
- `lib/date-only.ts`: fechas date-only.
- `lib/normalizers.ts`: frontera de saneamiento de datos.
- `lib/schemas.ts`: schemas de extracción y validación base, salvo si Sprint 2 necesita schemas nuevos separados.
- `app/api/contracts/[id]/validate/route.ts`: validación base y persistencia de amparos.
- `components/contract-detail-client.tsx`: edición y cálculo de detalle; tocar solo en secciones aisladas y con verificación visual.
- `docs/supabase-migrations/20260504_amparos_liquidacion_modificaciones.sql`: no editar migraciones históricas.
- `docs/supabase-migrations/20260511_contratos_base_calculo_amparos.sql`: no editar migraciones históricas.
- `lib/database.types.ts`: no regenerar ni editar manualmente salvo después de migraciones reales.

Para Sprint 2, conviene agregar módulos nuevos para cotizaciones, snapshots, PDF y emisión, en vez de mezclar esas responsabilidades dentro de extracción o cálculo de amparos.

## 12. Posibles limpiezas recomendadas

### Crítica

- Decidir y ejecutar una micro-limpieza de otrosíes antes de Sprint 2: ocultar/deshabilitar entrada UI, bloquear procesamiento de `otrosi` o aislar el flujo para que no pueda usarse hasta existir póliza emitida. No borrar datos sin plan si las columnas ya existen.
- Aclarar si `modificaciones_contractuales` y `amparos.modificacion_id` ya existen en Supabase de trabajo. Si existen, tratarlos como legado inactivo; si no existen, documentar que el flujo de otrosí actual fallaría.

### Importante

- Preparar una decisión de modelo para Sprint 2 antes de programar: tabla de cotizaciones, tabla o snapshot de amparos cotizados, relación de emisión y bloqueo.
- Evitar que cotización PDF lea únicamente datos vivos. Debe usar snapshot creado al generar PDF.
- Separar helpers de cotización/PDF de `coverage-calculations.ts`; reutilizar resultados, no recalcular reglas nuevas.
- Revisar el casing de `docs/Sprints` vs. la convención solicitada `docs/sprints` para evitar confusión en entornos case-sensitive.
- Documentar o crear en el futuro un baseline de esquema Supabase. Hoy solo hay migraciones incrementales.

### Puede esperar

- Limpiar assets default de `public/` si no se usarán.
- Actualizar branding documental de `README.md` y `docs/ARCHITECTURE.md` para reducir “Muñeco/MVP” cuando se haga el ajuste institucional.
- Considerar dividir `components/contract-detail-client.tsx` en subcomponentes después de Sprint 2 o en una limpieza dedicada. No hacerlo como prerequisito si retrasa el flujo comercial.
- Considerar renombrar uno de los helpers `normalizeText` para reducir ambigüedad futura.

## 13. Recomendación final

**B. Conviene hacer una micro-limpieza antes del Sprint 2.**

El repositorio funciona y pasó lint/test, pero no está conceptualmente limpio para arrancar cotización y emisión porque conserva un flujo activo de otrosíes. Ese flujo entra justo en conflicto con la regla central del Sprint 2: primero debe existir cotización versionada y póliza emitida/bloqueada; los otrosíes solo deben operar después sobre esa póliza emitida.

La micro-limpieza recomendada no debería tocar extracción IA, cálculo de amparos, RCE/PLO, anticipo ni validación base. Debe limitarse a neutralizar o aislar la capacidad de otrosíes y dejar explícito que seguirá fuera de alcance.

## 14. Próximo paso sugerido

Antes de implementar Sprint 2, hacer una decisión corta de alcance:

1. Confirmar si se deshabilita temporalmente `otrosi` en UI/API o si se deja escondido detrás de una condición futura de póliza emitida.
2. Definir el modelo mínimo de cotizaciones con snapshot y versión creada al generar PDF.
3. Definir el modelo mínimo de emisión/bloqueo como capa nueva, sin tocar el pipeline IA ni cálculo de amparos.
4. Implementar Sprint 2 en módulos nuevos y con pruebas sobre versionamiento, PDF sin datos internos y bloqueo de edición emitida.
