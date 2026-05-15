# Arquitectura del Repositorio

Este documento explica cómo está organizado **Muñeco Digital**, qué responsabilidad tiene cada parte del código y cómo fluye la información desde la carga del PDF hasta la validación humana.

## Visión General

Muñeco Digital es una aplicación Next.js con App Router. El frontend entrega las pantallas de carga, consulta y validación; el backend vive en Route Handlers dentro de `app/api/*`.

La aplicación sigue una regla central: los datos protegidos y las credenciales nunca se exponen al navegador. El cliente solo llama endpoints internos. Los endpoints usan la service role key de Supabase y las claves de Azure en servidor.

## Flujo Principal

1. La ejecutiva carga un PDF desde `/upload`.
2. El navegador envía el formulario a `POST /api/upload`.
3. El servidor crea o reutiliza el cliente, crea el contrato, sube el PDF a Supabase Storage y registra el documento.
4. El navegador llama `POST /api/contracts/[id]/process`.
5. El servidor cambia el contrato a `procesando`.
6. El servidor descarga el PDF desde Storage.
7. Azure Document Intelligence extrae texto página por página.
8. Azure OpenAI recibe el texto y devuelve JSON estructurado.
9. Zod valida estrictamente la respuesta.
10. El servidor guarda logs en `extracciones`, actualiza `contratos`, reemplaza `amparos` y deja el contrato en `pendiente_validacion`.
11. La ejecutiva revisa y corrige desde `/contratos/[id]`.
12. Al confirmar, `PUT /api/contracts/[id]/validate` guarda los cambios y pasa el contrato a `validado`.

## Estructura de Carpetas

```text
app/
  api/
    contracts/
      route.ts
      [id]/
        route.ts
        process/route.ts
        status/route.ts
        validate/route.ts
    dashboard/route.ts
    upload/route.ts
  contratos/
    page.tsx
    [id]/page.tsx
  upload/page.tsx
  layout.tsx
  page.tsx
  globals.css

components/
  contract-detail-client.tsx
  contracts-list.tsx
  dashboard-client.tsx
  status-badge.tsx
  upload-form.tsx

lib/
  ai.ts
  api.ts
  constants.ts
  coverage-calculations.ts
  database.types.ts
  env.ts
  format.ts
  processing.ts
  schemas.ts
  supabase-admin.ts

docs/
  ARCHITECTURE.md
```

## Responsabilidades por Capa

### `app/`

Contiene páginas y Route Handlers.

- `app/page.tsx`: dashboard inicial.
- `app/upload/page.tsx`: pantalla de carga de PDF.
- `app/contratos/page.tsx`: consulta y filtros de contratos.
- `app/contratos/[id]/page.tsx`: detalle y validación humana.
- `app/api/*`: backend interno de la aplicación.

Las páginas usan componentes cliente cuando necesitan estado, formularios, polling o llamadas `fetch`.

### `components/`

Contiene la UI interactiva.

- `upload-form.tsx`: formulario de carga y arranque de procesamiento.
- `contracts-list.tsx`: búsqueda, filtros y tabla de contratos.
- `contract-detail-client.tsx`: edición, fuentes, confianza, amparos y validación.
- `dashboard-client.tsx`: indicadores del dashboard.
- `status-badge.tsx`: badges reutilizables para estados y confianza.

Estos componentes no importan clientes server-only ni secretos. Solo llaman endpoints internos.

### `lib/`

Contiene la lógica compartida y de servidor.

- `supabase-admin.ts`: crea el cliente Supabase con `SUPABASE_SERVICE_ROLE_KEY`.
- `env.ts`: valida variables de entorno requeridas en servidor.
- `ai.ts`: integra Azure Document Intelligence y Azure OpenAI.
- `processing.ts`: orquesta el pipeline completo de extracción.
- `schemas.ts`: define validaciones Zod para IA, upload, filtros y validación humana.
- `database.types.ts`: tipos TypeScript alineados al esquema Supabase.
- `api.ts`: helpers para respuestas JSON y errores.
- `constants.ts`: estados, ejecutivas, bucket y versión de prompt.
- `coverage-calculations.ts`: funciones puras para calcular valores derivados de amparos antes de guardarlos.
- `format.ts`: helpers de formato para fechas, moneda, porcentajes y texto.

## Route Handlers

| Endpoint | Método | Responsabilidad |
| --- | --- | --- |
| `/api/dashboard` | `GET` | Devuelve conteos del dashboard. |
| `/api/upload` | `POST` | Crea/reusa cliente, crea contrato, sube PDF y registra documento. |
| `/api/contracts` | `GET` | Consulta contratos con filtros. |
| `/api/contracts/[id]` | `GET` | Devuelve contrato, cliente, documentos, amparos y tasas relevantes. |
| `/api/contracts/[id]/process` | `POST` | Inicia procesamiento con IA. |
| `/api/contracts/[id]/status` | `GET` | Devuelve estado para polling. |
| `/api/contracts/[id]/validate` | `PUT` | Guarda correcciones humanas y valida el contrato. |

Todos los endpoints usan `runtime = "nodejs"` porque necesitan SDKs de Supabase/Azure y procesamiento de archivos.

## Modelo de Datos

El esquema vive en Supabase y no se crea desde la app. El código espera estas tablas:

- `clientes`: cliente y ejecutiva responsable.
- `contratos`: datos estructurados del contrato y estado del flujo.
- `documentos`: metadatos del PDF cargado.
- `amparos`: garantías detectadas y luego validadas.
- `extracciones`: trazabilidad de intentos de IA, texto, JSON, tokens, resultado y errores.
- `tasas_referencia`: tasas vigentes de consulta, solo lectura en el MVP.

Los estados válidos del contrato están centralizados en `lib/constants.ts`.

## Pipeline de IA

La lógica principal está en `lib/processing.ts`.

El pipeline hace:

1. Cambia estado a `procesando`.
2. Busca el último documento del contrato.
3. Descarga el PDF desde Supabase Storage.
4. Llama `extractPdfTextByPage()` en `lib/ai.ts`.
5. Estima páginas del PDF y compara contra las páginas devueltas por Document Intelligence.
6. Construye un texto con separadores `--- Página N ---`.
7. Construye el contexto para OpenAI con `buildContractExtractionContext()`.
8. Llama Azure OpenAI con la deployment primaria.
9. Valida el JSON con `aiExtractionSchema`.
10. Registra la extracción con el texto completo extraído por Document Intelligence.
11. Si faltan campos críticos o hay demasiados campos con confianza baja, repite con la deployment fallback cuando esté configurada.
12. Calcula valores derivados de amparos en `coverage-calculations.ts`.
13. Guarda el mejor resultado en `contratos` y los amparos normalizados.
14. Cambia estado a `pendiente_validacion`.

Si algo falla, el contrato queda en `error`, se guarda `mensaje_error` y se inserta un registro en `extracciones` con `resultado = "error"`.

## Separación entre IA y Cálculo

El pipeline separa tres responsabilidades:

- Azure Document Intelligence extrae texto página por página desde el PDF.
- Azure OpenAI extrae reglas, campos explícitos y evidencia textual. Para amparos no debe hacer cálculos finales.
- El backend calcula valores derivados de amparos con funciones determinísticas.

El JSON completo de la IA se guarda únicamente en `extracciones.json_original`. En `contratos.extraido_ia` se guarda solo un booleano para indicar si el contrato ya tuvo extracción de IA.

Antes de actualizar `contratos` o insertar `amparos`, `lib/processing.ts` pasa la extracción por mappers explícitos y normalizadores centrales en `lib/normalizers.ts`. Esa frontera convierte campos anidados de IA a valores planos, aplica `COP` como moneda por defecto, descarta fechas inválidas, evita `NaN` y registra en desarrollo qué valores fueron corregidos o descartados. Esto protege columnas rígidas de Supabase como booleanos, fechas, numéricos y campos `NOT NULL`.

El contexto enviado a OpenAI no se limita al inicio del contrato. Si el PDF completo cabe bajo el límite de contexto, se envían todas las páginas. Si hay que recortar, se incluyen las primeras tres páginas, páginas con términos críticos y páginas vecinas para no cortar cláusulas; luego se priorizan valor, forma de pago, duración, plazo, garantías, pólizas, amparos, vigencia y acta de recibo final.

Si Document Intelligence devuelve una cobertura sospechosamente baja, por ejemplo dos páginas cuando el PDF parece tener muchas más, el procesamiento se detiene con error claro. Esto evita guardar una extracción parcial como si fuera una lectura válida y ayuda a detectar límites de tier o problemas del PDF.

El fallback no depende solo de confianza baja. También se activa cuando faltan campos críticos del MVP: `valor_contrato`, `plazo`, `fecha_inicio`, `fecha_fin` o garantías/amparos útiles.

La IA puede devolver porcentaje, cuantía fija, tipo de vigencia, base de vigencia, días adicionales y fechas explícitas cuando aparezcan en el contrato. El backend calcula `valor_asegurado`, `fecha_desde` y `fecha_hasta` cuando hay datos suficientes.

El cálculo de amparos marca `requiere_revision` y `motivo_revision` cuando falta información, la confianza es baja, la vigencia depende de acta de recibo final, la fuente es ambigua, el valor calculado es cero o negativo, o la cuantía aplica por empleado/persona/evento. Inferencias débiles sin fuente, página ni regla suficiente no se insertan en `amparos`.

Ningún contrato llega a `validado` sin confirmación humana desde la pantalla de detalle.

## Liquidación de Amparos

`lib/coverage-calculations.ts` concentra la liquidación determinística por amparo. La IA extrae reglas y evidencia; el backend calcula:

- `valor_base_calculo`
- `modo_calculo`
- `valor_asegurado`
- `fecha_desde`
- `fecha_hasta`
- `dias_vigencia`
- `prima_neta`
- `impuesto`
- `prima_total`

La fórmula implementada es:

```text
prima_neta = valor_asegurado * tasa * dias_vigencia / 365
impuesto = prima_neta * iva_porcentaje
prima_total = prima_neta + impuesto
```

`dias_adicionales` conserva la regla contractual, por ejemplo 30 días o 1095 días. `dias_vigencia` es la diferencia real entre `fecha_desde` y `fecha_hasta`; solo este valor alimenta la prima.

La pantalla de validación trata la información general del contrato como fuente de verdad para liquidar amparos. `contratos.base_calculo_amparos` guarda la base confirmada por la comercial y `contratos.base_calculo_incluye_iva` indica si esa base incluye IVA; si está en `null`, queda como no determinado. Al corregir base, fecha inicio o fecha fin en la sección general, los amparos se recalculan con esos datos salvo fechas manuales explícitas.

En la UI de cada amparo se muestran `fecha_desde`, fecha fin del contrato/base, `dias_adicionales`, `fecha_hasta` calculada y `dias_vigencia`. El usuario cambia `dias_adicionales` y el sistema suma automáticamente esos días sobre la base correcta. Para amparos postcontractuales que dependen de acta de recibo final o cierre, si no existe esa fecha, se usa `fecha_fin` del contrato como estimación de cotización y se conserva `requiere_revision`.

La UI no muestra la tabla de `tasas_referencia`. Esa tabla queda como fuente interna para prediligenciar la tasa editable del amparo. Si la comercial cambia la tasa en pantalla, `tasa_manual` queda marcada en la fila validada.

Responsabilidad Civil Extracontractual se modela como un solo amparo principal. La prima se calcula únicamente sobre la línea calculable PLO y la cuantía principal de la póliza. Los demás elementos exigidos por el contrato, como contratistas/subcontratistas, RC patronal, RC cruzada y vehículos propios/no propios, se guardan en `amparos.subamparos` como coberturas informativas. Cuando un sublímite proviene de la plantilla AFISEC y no del texto contractual, queda con `origen = regla_plantilla_afisec` y `requiere_revision = true`.

Los subamparos de Responsabilidad Civil son configurables en la pantalla de validación. La comercial puede incluirlos o excluirlos y editar porcentaje o valor de sublímite. `calculable = true` queda reservado para PLO; los demás subamparos son informativos y no generan prima individual. Si el contrato define una regla como 30% del PLO, el backend calcula el sublímite y marca `origen = contrato`.

El amparo `buen_manejo_anticipo` se calcula sobre el anticipo, no sobre el valor total del contrato. Si el documento indica porcentaje de anticipo y base sin IVA, el backend usa el valor sin IVA cuando está disponible o deriva base sin IVA desde valor total / 1.19. Si falta confirmar la base de IVA o falta valor/porcentaje del anticipo, el amparo queda en revisión humana.

Para otrosíes y prórrogas, se propone la tabla `modificaciones_contractuales` y la relación opcional `amparos.modificacion_id`. Las migraciones propuestas están en `docs/supabase-migrations/20260504_amparos_liquidacion_modificaciones.sql` y `docs/supabase-migrations/20260511_contratos_base_calculo_amparos.sql`; no automatizan todavía la gestión de otrosíes en UI.

La carga de documentos tipo `otrosi` ya no crea un contrato aislado: el usuario selecciona cliente y contrato base, el PDF se registra en `documentos` contra ese contrato y el procesamiento inserta una fila en `modificaciones_contractuales`. Si el otrosí trae nuevos amparos o ajustes, se insertan con `amparos.modificacion_id` para mantener trazabilidad. La vista histórica consolidada tipo Excel queda como trabajo posterior.

## Validación del JSON de IA

El archivo `lib/schemas.ts` define `aiExtractionSchema`. El modelo debe devolver exactamente la estructura esperada.

La app usa Structured Outputs mediante `zodResponseFormat()`, y además parsea y valida la respuesta con Zod. Si el JSON es inválido, se reintenta una vez. Si vuelve a fallar, el contrato queda en error.

La IA no debe inferir datos. Cuando no encuentra un campo, debe devolver `null` y agregar alertas si aplica.

Los campos numéricos no encontrados deben ser `null`, nunca `0`. El cero solo se acepta si aparece explícitamente en el contrato, y aun así el backend marca revisión cuando un valor derivado queda en cero o negativo.

## Seguridad

Reglas aplicadas en el repositorio:

- No hay claves de Azure en componentes cliente.
- No hay `SUPABASE_SERVICE_ROLE_KEY` en componentes cliente.
- Los writes a base de datos pasan por Route Handlers.
- Los componentes cliente consumen `/api/*`.
- La app no devuelve `storage_path` en el detalle del contrato.
- La app no genera signed URLs del PDF.
- RLS debe estar activo en Supabase y sin políticas públicas.

Sin autenticación en este MVP, cualquier persona con acceso al despliegue podría usar la herramienta. Para producción real, el siguiente paso natural es agregar autenticación y autorización antes de exponerlo fuera de un entorno controlado.

## Procesamiento en Vercel

`POST /api/contracts/[id]/process` usa `waitUntil()` cuando detecta `process.env.VERCEL === "1"`. Así puede responder rápido al navegador y dejar que el procesamiento continúe.

En desarrollo local, el endpoint procesa de forma síncrona para evitar un “fire-and-forget” frágil que se muera silenciosamente.

Para contratos largos o cargas concurrentes, conviene mover este pipeline a una cola durable, por ejemplo:

- Supabase Queue o tabla de jobs.
- Inngest, Trigger.dev o Temporal.
- Azure Functions o worker dedicado.

## Versionamiento de Prompt

`PROMPT_VERSION` vive en `lib/constants.ts`.

Cada extracción guarda `version_prompt` en `extracciones` y `contratos`, lo que permite comparar resultados si se mejora el prompt en versiones futuras.

## Extensión del MVP

Para agregar nuevas capacidades sin romper el alcance actual:

- Nuevos campos de extracción: actualizar `aiExtractionSchema`, prompt, mapping en `processing.ts` y UI de validación.
- Nuevos filtros: agregar parámetro en `contractListQuerySchema`, aplicar filtro en `/api/contracts` y añadir control en `contracts-list.tsx`.
- Nuevos estados: actualizar `CONTRACT_STATES`, badges, queries y documentación.
- Nuevos documentos por contrato: mantener `documentos` como fuente de metadatos y decidir si se procesa el último documento o uno específico.
- Autenticación: proteger Route Handlers y reemplazar el selector manual de ejecutiva por usuario autenticado.

## Comandos Útiles

```bash
npm run dev
npm run lint
npm run build
```

Durante desarrollo, si cambias tipos de rutas de Next.js, corre `npm run build`; suele detectar errores que el lint no ve.
