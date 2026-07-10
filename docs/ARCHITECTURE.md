# Arquitectura actual del repositorio AFISEC

## 1. Alcance

AFISEC es una aplicación Next.js que concentra:

- carga y extracción de contratos y órdenes;
- revisión humana y cálculo de amparos;
- resumen contextual generado por IA para documentos nuevos;
- cotizaciones base versionadas;
- registro y bloqueo de póliza base emitida;
- renovación manual de pólizas renovables;
- otrosíes secuenciales con liquidación incremental;
- cotizaciones de ajuste y registro de otrosí emitido.

La aplicación no expide pólizas en una aseguradora. Registra la emisión realizada
externamente y congela el snapshot correspondiente.

## 2. Principios de diseño vigentes

### 2.1 Servidor como frontera protegida

Los componentes cliente llaman Route Handlers bajo `/api`. El acceso a Supabase
con service role, Azure Document Intelligence y Azure OpenAI ocurre únicamente en
servidor.

### 2.2 IA para extracción, código para cálculo

La IA extrae campos, reglas y evidencia. Los valores asegurados, vigencias,
primas y liquidaciones se calculan mediante funciones determinísticas.

### 2.3 Revisión humana obligatoria

Un contrato no llega a `validado` sin confirmación humana. Un otrosí se puede
revisar y recalcular antes de generar su cotización de ajuste.

### 2.4 Versiones basadas en documentos

Validar no crea una versión. Generar un PDF sí crea una versión y guarda un
snapshot inmutable.

### 2.5 La emisión define el estado vigente

La póliza base emitida es el punto de verdad inicial. Cada otrosí emitido crea el
estado vigente utilizado por el siguiente otrosí.

## 3. Stack y runtime

- Node.js 22.
- Next.js 16.2.4 con App Router.
- versión de aplicación `0.4.1`.
- React 19.
- TypeScript.
- Tailwind CSS 4.
- Supabase PostgreSQL y Storage.
- Azure AI Document Intelligence.
- Azure OpenAI.
- Zod.

Las rutas API declaran `runtime = "nodejs"`. El proyecto se construye con
`next build` y se ejecuta con `next start`.

## 4. Estructura principal

```text
app/
  api/
    amendment-quotes/[id]/
      download/route.ts
      emit/route.ts
      revert/route.ts
    amendments/[id]/
      close/route.ts
      quotes/route.ts
      review/route.ts
    contracts/
      route.ts
      [id]/
        process/route.ts
        quotes/route.ts
        renewal/route.ts
        route.ts
        status/route.ts
        validate/route.ts
    dashboard/route.ts
    quotes/[id]/
      download/route.ts
      emit/route.ts
      revert/route.ts
    upload/route.ts
  contratos/
  upload/

components/
  amendments-panel.tsx
  contract-detail-client.tsx
  contracts-list.tsx
  dashboard-client.tsx
  status-badge.tsx
  upload-form.tsx

lib/
  ai.ts
  amendment-context.ts
  amendment-pdf.ts
  amendments.ts
  api.ts
  constants.ts
  coverage-calculations.ts
  database.types.ts
  date-only.ts
  env.ts
  format.ts
  normalizers.ts
  processing.ts
  quote-pdf.ts
  quotes.ts
  schemas.ts
  supabase-admin.ts

docs/
  Sprints/
  supabase-migrations/
```

## 5. Capas y responsabilidades

### 5.1 Páginas y componentes

- `dashboard-client.tsx`: métricas de contratos, cotizaciones base, pólizas y
  otrosíes.
- `upload-form.tsx`: selecciona primero el tipo de documento. Para otrosí exige
  cliente y contrato con póliza emitida.
- `contracts-list.tsx`: búsqueda y listado de contratos.
- `contract-detail-client.tsx`: revisión del contrato, amparos, cotizaciones,
  resumen emitido y renovación.
- `amendments-panel.tsx`: revisión, liquidación, cotización, emisión, reversión
  e histórico de otrosíes.
- `status-badge.tsx`: presentación de estados.

`contract-detail-client.tsx` y `amendments-panel.tsx` son componentes extensos.
No deben recibir refactors generales dentro de cambios funcionales pequeños.

### 5.2 Integraciones y procesamiento

- `env.ts`: lee y valida variables de entorno.
- `supabase-admin.ts`: crea el cliente Supabase con service role.
- `ai.ts`: Document Intelligence, prompts y Structured Outputs.
- `processing.ts`: orquesta extracción, fallback, normalización y persistencia
  de contratos y otrosíes.
- `schemas.ts`: contratos de entrada para IA y APIs.
- `normalizers.ts`: normaliza fechas, monedas, números, booleanos y enums.

### 5.3 Cálculo y snapshots

- `date-only.ts`: operaciones de fecha sin conversión a hora local.
- `coverage-calculations.ts`: liquidación determinística de amparos base.
- `quotes.ts`: snapshots, totales, validaciones comerciales y numeración de
  cotización base.
- `quote-pdf.ts`: PDF comercial de cotización base.
- `amendment-context.ts`: carga la póliza base y el último estado vigente.
- `amendments.ts`: secuencia, liquidación incremental, snapshots y validaciones
  de otrosí.
- `amendment-pdf.ts`: PDF comercial de cotización de ajuste.

## 6. Flujo de contrato base

1. `POST /api/upload` valida el formulario y el PDF.
2. Crea o reutiliza un cliente.
3. Crea el contrato en estado `cargado`.
4. Sube el PDF al bucket privado `contratos`.
5. Inserta el registro en `documentos`.
6. `POST /api/contracts/[id]/process` inicia el procesamiento.
7. `processing.ts` descarga el PDF.
8. Document Intelligence extrae texto por página.
9. Azure OpenAI devuelve una estructura validada por Zod.
10. El backend aplica normalizadores y fallbacks determinísticos.
11. Si la extracción final incluye resumen documental y el contrato no tenía uno,
    se persiste en `contratos.resumen_documento_ia`.
12. `coverage-calculations.ts` calcula los amparos.
13. Se actualizan `contratos`, `amparos` y `extracciones`.
14. El contrato queda en `pendiente_validacion`.
15. La revisión humana se guarda mediante
    `PUT /api/contracts/[id]/validate`.
16. El contrato queda en `validado`.

`contrato_base`, `orden` y `orden_compra` comparten este flujo. El subtipo se
envía como instrucción contextual al mismo prompt y no crea modelos paralelos.

La cobertura de páginas solo bloquea cuando el contador confiable
`/Catalog -> /Pages -> /Count` muestra faltantes significativos. El conteo de
objetos `/Type /Page` se conserva como diagnóstico no bloqueante.

Estados de contrato centralizados:

```text
cargado
procesando
procesado_ia
pendiente_validacion
validado
error
```

## 7. Cálculo de amparos base

La fórmula general es:

```text
prima_neta = valor_asegurado * tasa * dias_vigencia / 365
iva = prima_neta * iva_porcentaje
prima_total = prima_neta + iva
```

Reglas relevantes:

- `base_calculo_amparos` es la base confirmada por la revisión humana.
- Las fechas se manejan como `YYYY-MM-DD` mediante helpers date-only.
- Vigencia contractual cubre el plazo completo más el periodo adicional.
- Vigencia postcontractual inicia desde su fecha base final.
- Overrides manuales solo se aplican cuando el usuario los activa.
- `fecha_desde` y `fecha_hasta` guardan la fecha efectiva del amparo; los flags
  `fecha_desde_manual` y `fecha_hasta_manual` indican si esa fecha fue fijada
  manualmente.
- El buen manejo de anticipo utiliza la base de anticipo.
- RCE/PLO es una línea principal calculable.
- Los subamparos RCE son informativos y no generan prima individual.
- La prima neta puede fijarse manualmente por amparo.

Cuando `usar_prima_neta_manual = true`, el cálculo conserva
`prima_neta_automatica` como referencia y usa `prima_neta_manual` para obtener
IVA y prima total. El snapshot y el PDF consumen únicamente los valores finales.

La validación recalcula en servidor antes de reemplazar los amparos. Si hay una
cotización base en estado `emitida`, el endpoint rechaza la edición directa.

## 8. Cotización y emisión de póliza base

### 8.1 Generación

`POST /api/contracts/[id]/quotes`:

1. exige contrato `validado`;
2. impide generar una nueva cotización si existe emisión activa;
3. crea el siguiente número de versión;
4. construye un snapshot de contrato, cliente y amparos;
5. bloquea filas comerciales incompletas;
6. genera el PDF en memoria;
7. sube el PDF a Supabase Storage;
8. inserta la versión en `cotizaciones`.

El PDF no muestra tasa, fuentes, confianza, JSON ni motivos internos.

`DELETE /api/quotes/[id]` elimina físicamente una cotización únicamente si está
en estado `generada` y nunca tuvo emisión ni reversión. El endpoint borra la
fila y remueve el PDF asociado de Storage; si Storage falla, no devuelve éxito
falso y reporta la limitación operativa.

### 8.2 Estados

```text
generada
emitida
emision_revertida
anulada
```

El índice parcial de base de datos impide más de una cotización `emitida` por
contrato.

### 8.3 Emisión

`POST /api/quotes/[id]/emit` marca una versión generada como emitida. La acción:

- conserva el snapshot original;
- registra fecha de emisión;
- bloquea validación y edición directa;
- habilita el flujo de otrosí.

`POST /api/quotes/[id]/revert` conserva trazabilidad y permite volver al flujo
editable.

## 9. Renovación

`POST /api/contracts/[id]/renewal` solo opera cuando:

- `renovable_automaticamente = true`;
- existe una póliza base emitida;
- el snapshot emitido es legible;
- las fechas suministradas son válidas.

La renovación no usa IA ni crea un otrosí. Recalcula las vigencias desde el
snapshot emitido y crea una nueva versión de cotización base.

## 10. Flujo de otrosí

### 10.1 Reglas de entrada

`POST /api/upload` permite `tipoDocumento = "otrosi"` únicamente cuando:

- se seleccionó un contrato;
- el contrato tiene una póliza base `emitida`;
- no existe otro otrosí en estado no terminal.

El documento se asocia al contrato base y se crea una fila en
`modificaciones_contractuales` con secuencia incremental.

### 10.2 Procesamiento

`POST /api/contracts/[id]/process` despacha el documento al flujo de contrato o
al flujo de otrosí. Para otrosí:

- la IA extrae el delta;
- el estado vigente anterior tiene prioridad sobre valores históricos
  contradictorios;
- fechas, valores periódicos y clasificación reciben fallbacks determinísticos;
- impuesto de timbre se conserva como alerta informativa.

### 10.3 Revisión

`PUT /api/amendments/[id]/review`:

- guarda valores revisados;
- recalcula liquidación;
- actualiza snapshots previo y resultante propuesto;
- permite guardar aunque la póliza base tenga una alerta crítica.

Las alertas críticas de la base bloquean cotización y emisión, no la revisión.

### 10.4 Liquidación incremental

La liquidación separa:

- prima por valor adicionado;
- prima por prórroga;
- prima neta del ajuste;
- IVA;
- prima total.

Los días de prórroga se derivan de las fechas revisadas. Los días de adición se
calculan con la vigencia propia de cada amparo. RCE/PLO no genera prima por
adición cuando su cuantía fija no cambia.

### 10.5 Cotización de ajuste

`POST /api/amendments/[id]/quotes`:

1. exige revisión validada;
2. verifica integridad de la póliza base y RCE/PLO;
3. recalcula la liquidación;
4. crea una versión por otrosí;
5. guarda snapshot y PDF en Storage;
6. actualiza el otrosí a `cotizado`.

El PDF separa:

- total garantías/cumplimiento;
- total responsabilidad civil;
- total general.

### 10.6 Emisión y reversión

`POST /api/amendment-quotes/[id]/emit`:

- impide emitir una versión si ya existe otra emitida para el mismo otrosí;
- verifica secuencia anterior;
- congela el snapshot resultante;
- actualiza la cotización y `modificaciones_contractuales`.

`POST /api/amendment-quotes/[id]/revert` solo permite reversar el último otrosí
emitido activo.

Los estados internos conservan nombres históricos:

```text
cargado
procesando
pendiente_revision
validado
cotizado
endoso_emitido
no_aplicable
anulado
error
pendiente_aplicacion
aplicada
```

La UI traduce `endoso_emitido` como `Otrosí emitido`. Los términos internos no
deben aparecer en documentos comerciales.

## 11. Route Handlers

| Ruta | Método | Responsabilidad |
| --- | --- | --- |
| `/api/dashboard` | GET | Métricas de contratos, cotizaciones y otrosíes. |
| `/api/upload` | POST | Carga contrato, orden u otrosí. |
| `/api/contracts` | GET | Lista y busca contratos. |
| `/api/contracts/[id]` | GET | Detalle consolidado del contrato. |
| `/api/contracts/[id]` | DELETE | Elimina contrato y dependencias cuando nunca hubo emisión. |
| `/api/contracts/[id]/process` | POST | Procesa contrato u otrosí con IA. |
| `/api/contracts/[id]/status` | GET | Estado para polling. |
| `/api/contracts/[id]/validate` | PUT | Guarda revisión del contrato base. |
| `/api/contracts/[id]/quotes` | POST | Genera cotización base. |
| `/api/contracts/[id]/renewal` | POST | Genera cotización de renovación. |
| `/api/quotes/[id]` | DELETE | Elimina cotización base no emitida y su PDF. |
| `/api/quotes/[id]/download` | GET | Descarga PDF base. |
| `/api/quotes/[id]/emit` | POST | Registra emisión de póliza base. |
| `/api/quotes/[id]/revert` | POST | Revierte emisión base. |
| `/api/amendments/[id]/review` | PUT | Guarda y recalcula revisión de otrosí. |
| `/api/amendments/[id]/quotes` | POST | Genera cotización de ajuste. |
| `/api/amendments/[id]/close` | POST | Cierra un otrosí no emitido. |
| `/api/amendment-quotes/[id]/download` | GET | Descarga PDF de ajuste. |
| `/api/amendment-quotes/[id]/emit` | POST | Registra otrosí emitido. |
| `/api/amendment-quotes/[id]/revert` | POST | Revierte el último otrosí emitido. |

## 12. Modelo de datos

### Tablas base

- `clientes`: cliente y ejecutiva.
- `contratos`: datos revisados, estado y configuración de renovación.
- `documentos`: metadatos y ruta privada del PDF.
- `amparos`: liquidación base y subamparos.
- `extracciones`: trazabilidad de IA, texto, JSON, alertas y errores.
- `tasas_referencia`: tasas internas de consulta.

### Sprint 2

- `cotizaciones`: versiones, estado, snapshot, totales y referencia al PDF.

Restricciones:

- `unique (contrato_id, version)`;
- una sola fila `emitida` por contrato mediante índice parcial.

### Sprint 3

- `modificaciones_contractuales`: delta, secuencia, revisión, liquidación y
  snapshots vigente anterior/resultante.
- `cotizaciones_ajuste`: versiones de PDF y emisión por otrosí.

Restricciones:

- `unique (modificacion_id, version)`;
- un solo otrosí no terminal por contrato mediante índice parcial;
- una sola cotización de ajuste emitida por otrosí mediante índice parcial.

Los IDs y claves foráneas del dominio usan `bigint/int8`.

### Sprint 4

`amparos` agrega:

- `usar_prima_neta_manual`;
- `prima_neta_manual`;
- `prima_neta_automatica`.

La función `eliminar_contrato_no_emitido(bigint)` elimina dependencias dentro de
una transacción y rechaza cualquier póliza u otrosí con historia emitida.

`documentos.tipo_documento` debe coincidir con `DOCUMENT_TYPES`
(`contrato_base`, `orden`, `orden_compra`, `otrosi`). PostgreSQL valida esos
valores mediante `documentos_tipo_documento_check`; `otro` se conserva solo por
compatibilidad histórica.

### v0.4.1

`contratos` agrega:

- `resumen_documento_ia`.

`amparos` agrega:

- `fecha_desde_manual`;
- `fecha_hasta_manual`.

Las columnas `fecha_desde` y `fecha_hasta` siguen guardando la fecha efectiva
usada para calcular días y primas. Los flags indican si esa fecha debe tratarse
como manual o si debe recalcularse desde la regla de vigencia.

## 13. Trazabilidad de registros

La aplicación conserva tres niveles de evidencia:

1. **Documento original:** `documentos` más el archivo privado en Storage.
2. **Extracción y revisión:** `extracciones`, datos revisados y liquidaciones.
3. **Documento comercial emitible:** `cotizaciones` o
   `cotizaciones_ajuste` con snapshot y PDF.

Mapa de escritura:

| Acción | Escrituras verificables |
| --- | --- |
| Carga base | cliente, contrato, documento y archivo PDF. |
| Procesamiento base | log de extracción, contrato y amparos. |
| Validación base | contrato validado y reemplazo de amparos base. |
| Cotización base | PDF y versión nueva en `cotizaciones`. |
| Eliminación de cotización no emitida | borrado definitivo de fila y PDF asociado. |
| Emisión base | estado y fechas de la versión seleccionada. |
| Carga de otrosí | documento y modificación con secuencia. |
| Revisión de otrosí | campos revisados, liquidación y snapshots propuestos. |
| Cotización de ajuste | PDF y versión nueva en `cotizaciones_ajuste`. |
| Emisión de otrosí | snapshot emitido y estado vigente resultante. |
| Reversión | estado y motivo; no elimina la versión ni el PDF. |
| Eliminación de prueba | función transaccional de DB y limpieza posterior de Storage. |

`extracciones.json_original` conserva la salida estructurada de IA. Los PDFs
comerciales no incluyen JSON, prompts, confianza ni fuentes internas.

## 14. Storage y PDF

El bucket privado es `contratos`.

Los PDFs se generan en memoria y utilizan el logo local:

```text
public/brand/Logo_Color_Afisec_cuadrado.png
```

No se usan logos externos. Los PDFs se almacenan en Supabase Storage y se
descargan mediante endpoints del servidor.

No existe escritura persistente de documentos en disco local.

## 15. Seguridad

Controles presentes:

- secretos sin prefijo `NEXT_PUBLIC`;
- service role utilizada solo en servidor;
- rutas de Storage no incluidas en la respuesta general del contrato;
- RLS habilitado en migraciones nuevas;
- writes concentrados en Route Handlers.

Riesgo pendiente:

- no existe autenticación ni autorización;
- quien tenga acceso HTTP a la aplicación puede invocar los endpoints;
- hasta incorporar control de acceso, el despliegue debe restringirse a un
  entorno interno.

## 16. Consistencia e integridad

Las restricciones únicas de PostgreSQL protegen las emisiones activas y el
versionamiento. Sin embargo, algunas operaciones abarcan Storage y varias
actualizaciones de base de datos:

- subir PDF e insertar cotización;
- emitir cotización de ajuste y actualizar el otrosí;
- cerrar cotización y modificación.

No existe una transacción distribuida entre Supabase Storage y PostgreSQL. Un
fallo intermedio puede dejar un PDF huérfano o requerir corrección operativa.

Para eliminar contratos de prueba, PostgreSQL se confirma primero y Storage se
limpia después. Un fallo de Storage puede dejar un archivo huérfano, pero no una
base con referencias a un archivo ya eliminado.

## 17. Procesamiento y despliegue

En Vercel, el procesamiento puede usar `waitUntil()` cuando
`process.env.VERCEL === "1"`. En otros entornos, incluido Azure App Service, el
Route Handler espera el procesamiento de forma síncrona.

El despliegue actual recomendado usa Azure App Service Linux con Node 22:

```bash
npm ci
npm run build
npm run start
```

Para mayor carga o documentos extensos, el procesamiento debería migrarse a un
worker o cola durable sin cambiar las reglas de negocio.

El dashboard obtiene la versión desde `package.json` y muestra la etiqueta de
release. `APP_BUILD_TIME` y `APP_COMMIT_SHA` son metadata opcional no sensible.

## 18. Pruebas

`scripts/validate-normalizers.mjs` cubre mediante aserciones:

- normalización de números, moneda, fechas y booleanos;
- valor mensual multiplicado por periodos;
- Acta de Inicio con fecha provisional;
- vigencias contractuales y postcontractuales;
- RCE/PLO;
- anticipo;
- extracción determinística de otrosí;
- liquidación incremental;
- días de adición por vigencia propia del amparo;
- separación de totales de garantías y responsabilidad civil.
- conteo confiable y aproximado de páginas;
- prima neta manual y retorno al cálculo automático;
- confirmación fuerte para eliminación.

Pendiente:

- pruebas de Route Handlers;
- pruebas contra Supabase;
- pruebas de navegador;
- pruebas de concurrencia y fallos parciales.

## 19. Documentación de Sprints

- Sprint 1 conserva la auditoría previa a cotización y emisión.
- Sprint 2 conserva la especificación de cotización, snapshots y póliza base.
- Sprint 3 conserva referencias funcionales, decisiones e implementación de
  otrosíes.
- Sprint 4 documenta estabilización, prima manual, eliminación y versión
  desplegada.

Los estados históricos deben leerse junto con las secciones de cierre de cada
Sprint. El código, las migraciones y las pruebas representan la fuente técnica
vigente.
