# Sprint 5: Ajustes funcionales del cotizador AFISEC

## 1. Objetivo

Resolver cuatro necesidades operativas surgidas en el uso real:

1. cotizar sin cargar un documento;
2. interpretar y calcular correctamente fechas y periodos adicionales en días,
   meses y años;
3. hacer robusto el PDF de cotización frente a contenido de longitud variable;
4. presentar Responsabilidad Civil como una póliza distinta de Cumplimiento.

No incluye rediseño visual de la interfaz, cambios de fórmulas comerciales ni
emisión independiente por póliza.

## 2. Contexto de negocio

- Las usuarias cotizaban fuera de la plataforma cuando no existía contrato, el
  pliego era demasiado grande o recibían los datos directamente.
- Cumplimiento y Responsabilidad Civil son pólizas distintas. El PDF anterior
  mostraba un "Total general" que las sumaba como si fueran una sola.
- Los periodos adicionales se expresaban solo en días, aunque los contratos los
  describen como "2 meses más" o "1 año".

Decisiones de negocio aplicadas:

| Tema | Decisión |
| --- | --- |
| Tomador | Cliente que toma la póliza; reutiliza `clientes`. |
| Asegurado/beneficiario | Corresponde a `contratos.contratante`. |
| Datos mínimos de una cotización manual | Tomador, asegurado/contratante, valor, fecha inicial, fecha final, objeto y al menos un amparo. El número es opcional (`Sin número`). |
| Documento posterior | Una cotización manual no se reprocesa con IA. |
| Otras coberturas | Conservan su comportamiento actual; se agrupan con Cumplimiento. |
| Emisión, reversión y versionamiento | Siguen a nivel de la cotización completa. |
| Total general | No se presenta al usuario; cada póliza muestra su propio total. |
| Meses y años | Aritmética de calendario con ajuste a fin de mes y años bisiestos. |
| Días hábiles | No se calculan; se marcan para revisión manual. |
| Título del PDF | Se mantiene. |
| Contenido largo en PDF | Hace wrapping y continúa en páginas adicionales. |
| Otrosíes | Sin ampliar su presentación funcional. |

## 3. Análisis realizado (comprobado contra el código)

### 3.1 Cotización sin documento

- `POST /api/upload` exigía un PDF. El resto del flujo (validar, cotizar, PDF,
  emitir, renovar, otrosí) no consulta `documentos`.
- `/process` marcaría como `error` un contrato sin documento.
- El detalle ya soportaba contratos sin documento y "Agregar amparo".

### 3.2 Fechas y periodos

- `normalizeDate` acepta solo ISO y `dd/mm/aaaa`.
- El extractor de fechas por texto solo reconocía `D de mes de AAAA`; no
  reconocía "del", coma, ordinales, números en palabras ni `dd.mm.aaaa`.
- Los periodos adicionales eran un entero de días (`dias_adicionales`). El prompt
  pedía a la IA convertir meses y años a días; el código convertía 1 mes en 30
  días y 1 año en 365.
- "Dos meses más" produce 0 días sin alerta. "Pago a 30 días" se confundía con el
  periodo adicional.
- `addDuration` usaba `setUTCMonth` y 2026-12-31 + 2 meses daba 2027-03-03.

### 3.3 PDF

La causa de los desbordes era la tabla de anchos estimados
(`getApproxCharWidth`), que subestimaba los dígitos un 14 % frente a Helvetica
real. Medido sobre un PDF de prueba, cifras como `$ 12.464.148.148,96` terminaban
6 pt fuera de la celda y del margen. Además:

- encabezado "Valor asegurado" alineado distinto a sus datos;
- bloque de totales sin garantía de permanecer unido;
- cifras que podían partirse en el símbolo `$`;
- filas más altas que una página sin división.

### 3.4 Responsabilidad Civil

- Existían siete detectores de RCE con criterios distintos. El de
  `coverage-calculations` y el de `processing` evaluaban `tipo_amparo + fuente_texto`
  con subcadenas como `plo`, `labores`, `operaciones`. Un amparo de Cumplimiento
  con la palabra "ejemplo" en su fuente se convertía en RCE con valor asegurado
  nulo; y `prepareCoverageRecords` lo absorbía, eliminándolo de la lista.
- El snapshot era plano y el PDF/UI sumaban un "Total general".

## 4. Decisiones técnicas

### 4.1 Nueva cotización

Se reutiliza `contratos` con la columna `origen` (`documento` | `manual`). Una
tabla nueva habría duplicado validar, cotizar, PDF, versionamiento, emisión,
renovación y otrosí.

- `POST /api/contracts` crea cliente (`createOrReuseClient`, ahora en
  `lib/clients.ts`) y contrato `origen='manual'` en `pendiente_validacion`.
- La captura de valor, fechas, objeto y amparos usa la pantalla de revisión
  existente.
- `PUT /validate` exige los datos mínimos cuando `origen='manual'`
  (`lib/manual-quote.ts`).
- `normalizeCoverage` no agrega motivos de "fuente insuficiente" ni "confianza
  baja" a amparos manuales.
- `/process` rechaza contratos manuales o sin documento y ahora también contratos
  con póliza base emitida.

### 4.2 Periodos adicionales

- `amparos.periodo_adicional_cantidad` y `periodo_adicional_unidad`
  (`dias` | `meses` | `anios`). `dias_adicionales` se conserva como equivalente en
  días calculado contra la fecha base.
- Los registros existentes (columnas nulas) se interpretan como `dias_adicionales`
  en días. No hay backfill.
- `date-only.ts` incorpora `addMonthsToDateOnly` y `addPeriodToDateOnly` con
  ajuste a fin de mes.
- `lib/spanish-dates.ts` (funciones puras): `findAdditionalPeriod`,
  `parseSpanishNumberWords` y `parseSpanishDate`.
- Selección del periodo: prefiere el seguido de "más/adicional", descarta plazos
  de pago y marca "días hábiles".
- La fecha hasta manual prevalece sobre el periodo.
- La IA devuelve `periodo_adicional {cantidad, unidad}` tal como aparece en el
  texto. Un 0 o la ausencia dejan actuar al texto de la cláusula; si el periodo
  se tomó del texto y la IA había entregado 0, el amparo queda para revisión.
- Fechas devueltas por el modelo en texto largo se convierten antes de validar el
  esquema (`repairExtractionDates`), solo en campos de fecha.
- El snapshot incorpora `periodo_adicional` por amparo cuando la fecha hasta no
  es manual; la renovación lo reaplica sobre la nueva fecha fin. Sin él conserva
  la diferencia en días anterior.

### 4.3 PDF

- `lib/pdf/text.ts`: anchos AFM reales de Helvetica y Helvetica-Bold (WinAnsi),
  normalización NFC, `wrapText` (las cifras no se parten) y `fitFontSize`.
- `lib/pdf/table.ts`: motor de tablas compartido por `quote-pdf` y
  `amendment-pdf`. Las celdas alineadas a la derecha son numéricas: una línea y
  reducción de fuente si no caben. `keepTogether` mantiene bloques unidos; las
  filas más altas que una página se dividen y continúan.
- Se conserva el escritor PDF propio; no se añade librería.

### 4.4 Pólizas

- No se crea tabla de pólizas: la emisión es por cotización completa, así que una
  entidad por póliza obligaría a rediseñar emisión, reversión, índices parciales
  y otrosíes.
- `lib/coverage-policy.ts` es el clasificador único. Decide por el nombre del
  amparo con patrones de palabra completa; el texto fuente solo decide cuando el
  nombre no identifica el amparo y no corresponde a una cobertura conocida.
  Cumplimiento, anticipo, salarios, calidad, etc. nunca se reclasifican por la
  cláusula.
- Snapshot v2 (`schema_version: 2`): `poliza` por amparo y `polizas[]` con
  totales por póliza. `totales` se conserva únicamente por compatibilidad con
  `cotizaciones.total_*`. Los snapshots v1 se agrupan al leerse con el mismo
  clasificador.
- PDF y UI: secciones "Póliza de cumplimiento" y "Póliza de responsabilidad
  civil", cada una con su total. Subamparos de RC anidados dentro de la póliza de
  RC, con la nota de que la prima corresponde a la línea principal RCE/PLO.
  Se eliminó "Total general". Etiquetas del PDF: "Tomador" y
  "Asegurado / contratante".

## 5. Cambios implementados

Archivos nuevos: `lib/pdf/text.ts`, `lib/pdf/table.ts`, `lib/coverage-policy.ts`,
`lib/spanish-dates.ts`, `lib/renewal.ts`, `lib/clients.ts`, `lib/manual-quote.ts`,
`components/new-quote-form.tsx`, `app/cotizaciones/nueva/page.tsx`,
`scripts/run-tests.mjs`, `scripts/pdf-inspect.mjs`, cinco archivos
`scripts/validate-*.mjs` nuevos y dos migraciones.

Archivos modificados: `lib/quote-pdf.ts`, `lib/amendment-pdf.ts`,
`lib/quotes.ts`, `lib/coverage-calculations.ts`, `lib/processing.ts`,
`lib/ai.ts`, `lib/schemas.ts`, `lib/date-only.ts`, `lib/amendments.ts`,
`lib/database.types.ts`, `lib/constants.ts`, rutas `contracts`, `process`,
`validate`, `renewal` y `upload`, `contract-detail-client.tsx`,
`amendments-panel.tsx` y `app-shell.tsx`.

Versión `0.5.0`; `PROMPT_VERSION` pasa a `afisec-v0.5.0`.

## 6. Migraciones (preparadas, no aplicadas)

Aplicar en Supabase **antes** de desplegar el código, en este orden:

1. `docs/supabase-migrations/20261001_sprint5_periodo_adicional.sql`
   - `amparos.periodo_adicional_cantidad integer`
   - `amparos.periodo_adicional_unidad text` con restricciones de valor y de
     consistencia (ambas nulas o ambas definidas).
2. `docs/supabase-migrations/20261001_sprint5_origen_cotizacion.sql`
   - `contratos.origen text not null default 'documento'` con `check`.

Ambas son no destructivas. El código nuevo inserta las columnas en cada
`amparos`/`contratos` nuevo, por lo que desplegar sin migrar produce errores de
inserción.

## 7. Compatibilidad

- Cotizaciones y PDFs ya generados no cambian; `download` sirve el archivo
  almacenado. La UI agrupa por póliza cualquier snapshot v1.
- Amparos existentes sin unidad se leen como días.
- Un caso existente cambia por decisión de negocio: "tres (3) meses más" sobre una
  fecha fin 2025-02-02 ahora termina el 2025-05-02 (89 días) y no el 2025-05-03
  (90 días). El test correspondiente fue actualizado.
- Otrosíes: sin cambios de presentación; solo usan el clasificador único y el
  motor PDF compartido. Su "Total general del otrosí" se mantiene. La prórroga de
  amparos con periodo en meses se sigue recalculando por diferencia de días.
- Emisión, reversión, versionamiento, índices parciales y `cotizaciones.total_*`
  no cambian.

## 8. Pruebas

`npm test` ejecuta cada `scripts/validate-*.mjs` en su proceso:

| Archivo | Cubre |
| --- | --- |
| `validate-normalizers.mjs` | Suite existente (un caso actualizado). |
| `validate-pdf.mjs` | Anchos AFM, cifras indivisibles, NFC, contenido largo, tabla de 60 amparos, PDF de otrosí; todo texto dentro de su celda y margen. Verificado también contra el generador original (falla allí). |
| `validate-policies.mjs` | Clasificador, falsos positivos, extracción sin absorción de Cumplimiento, snapshot v1/v2, PDF por póliza sin "Total general". |
| `validate-periods.mjs` | Aritmética de calendario, lectura de periodos, `normalizeCoverage` con unidad, registros previos, días hábiles, snapshot y renovación. |
| `validate-manual-quote.mjs` | Datos mínimos, esquema de creación, motivos de revisión manual. |
| `validate-extraction-dates.mjs` | Formatos de fecha, reparación de fechas del modelo, fallback con fin de mes, periodo del modelo y del texto. |

Resultado final: `npm test`, `npm run lint` y `npm run build` sin errores.
Revisión visual del PDF con `pdftoppm` sobre una cotización con las dos pólizas.

## 9. Riesgos

- El clasificador por nombre puede dejar un amparo de RC con un nombre atípico en
  Cumplimiento. Mitigación: el texto fuente decide cuando el nombre es genérico,
  y la batería de casos es ampliable.
- La interpretación determinista de periodos puede equivocarse en cláusulas con
  varios periodos. Mitigación: prefiere el periodo seguido de "más/adicional",
  descarta pagos y la fecha manual siempre prevalece.
- No se probó contra Azure OpenAI ni Supabase; el schema de salida estructurada
  cambió (`periodo_adicional` con valor por defecto, como otros campos del
  esquema). Debe verificarse con un documento real tras el despliegue.
- Los snapshots v1 se leen con el clasificador actual; si un amparo se clasificó
  distinto en el pasado, su agrupación en pantalla puede variar (el PDF ya
  generado no).

## 10. Limitaciones y pendientes

- Sin calendario laboral ni festivos: "días hábiles" se marca para revisión.
- El conteo de días sigue siendo el existente (sin incluir el día final, divisor
  365).
- Otrosíes: periodos en meses se reaplican por días; "Total general del otrosí"
  no cambia.
- La batería de fechas y periodos debe ampliarse con cláusulas reales cuando
  estén disponibles.
- Recomendables no incluidos: tasas de revisión ignoradas al cotizar otrosíes,
  borrado de amparos de otrosí en `validate`, código muerto
  `processAmendmentExtraction`, unificación de cálculos de prima, un solo
  workflow de despliegue.
- Sin autenticación; sin procesamiento asíncrono.
