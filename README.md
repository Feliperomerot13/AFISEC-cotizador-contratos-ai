# AFISEC | Gestión de cotizaciones contractuales

Aplicación interna para revisar contratos y órdenes, calcular amparos, generar
cotizaciones versionadas y registrar la emisión de pólizas base. También soporta
otrosíes secuenciales sobre una póliza emitida, con liquidación incremental,
cotización de ajuste e histórico.

La expedición real de la póliza o del otrosí ocurre fuera de esta aplicación. El
sistema registra la emisión confirmada y conserva el snapshot que se convierte
en punto de verdad para los pasos posteriores.

## Estado funcional

El repositorio contiene los flujos implementados en los Sprints 1, 2 y 3:

- carga de contratos, órdenes de compra, órdenes de servicio y otrosíes;
- extracción de texto con Azure AI Document Intelligence;
- extracción estructurada con Azure OpenAI y validación Zod;
- revisión humana de datos generales, fechas, valores y amparos;
- cálculo determinístico de valores asegurados, vigencias y primas;
- resumen contextual generado por IA para documentos nuevos;
- prima neta manual por amparo con cálculo automático conservado como referencia;
- RCE/PLO como línea principal calculable y subamparos informativos;
- manejo de anticipo, Acta de Inicio y Acta de Recibo Final;
- cotizaciones base PDF con versiones y snapshots inmutables;
- registro, bloqueo y reversión de la emisión de póliza base;
- renovación manual de pólizas marcadas como renovables;
- otrosíes secuenciales sobre el último estado emitido;
- liquidación incremental por adición y prórroga;
- cotizaciones de ajuste versionadas y emisión/reversión de otrosí;
- histórico operativo de póliza base y otrosíes.
- eliminación física protegida de contratos nunca emitidos;
- eliminación definitiva de cotizaciones no emitidas;
- versión visible en la interfaz.

No están implementados:

- autenticación o autorización;
- integración con SoftSeguros o portales de aseguradoras;
- cúmulo y cupos;
- notificaciones externas;
- reportes gerenciales;
- procesamiento mediante una cola durable.

## Flujos principales

### Contrato base

```text
Carga PDF
  -> extracción IA
  -> revisión editable
  -> validación humana
  -> cotización PDF versionada
  -> registro de póliza emitida
  -> bloqueo de edición directa
```

Validar la revisión no crea una versión. La versión nace al generar el PDF. Cada
cotización guarda un snapshot independiente de los datos vivos del contrato.

### Otrosí

```text
Póliza base emitida
  -> carga del otrosí
  -> extracción del delta
  -> revisión editable
  -> liquidación incremental
  -> cotización de ajuste versionada
  -> registro de otrosí emitido
  -> nuevo estado vigente
```

Solo se permite un otrosí en revisión por contrato. El siguiente parte del
snapshot resultante del último otrosí emitido. Internamente algunos identificadores
históricos usan `amendment` o `endoso_emitido`; la interfaz comercial usa
exclusivamente el término `Otrosí`.

## Stack

- Node.js 22.
- Next.js 16 con App Router y Route Handlers.
- React 19 y TypeScript.
- Tailwind CSS 4.
- Supabase PostgreSQL y Supabase Storage.
- Azure AI Document Intelligence.
- Azure OpenAI.
- Zod.

Todas las rutas API que procesan datos usan runtime Node.js.

## Configuración local

```bash
npm install
cp .env.example .env.local
npm run dev
```

La aplicación queda disponible en `http://localhost:3000`.

## Variables de entorno

La lista fuente está en [.env.example](./.env.example).

| Variable | Uso | Exposición |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase. | Pública. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave anon de Supabase. | Pública. |
| `SUPABASE_SERVICE_ROLE_KEY` | Lecturas y escrituras protegidas desde Route Handlers. | Secreta, solo servidor. |
| `AZURE_DOC_INTEL_ENDPOINT` | Endpoint de Document Intelligence. | Configuración de servidor. |
| `AZURE_DOC_INTEL_KEY` | Credencial de Document Intelligence. | Secreta. |
| `AZURE_OPENAI_ENDPOINT` | Endpoint de Azure OpenAI. | Configuración de servidor. |
| `AZURE_OPENAI_KEY` | Credencial de Azure OpenAI. | Secreta. |
| `AZURE_OPENAI_DEPLOYMENT_PRIMARY` | Deployment principal de extracción. | Configuración de servidor. |
| `AZURE_OPENAI_DEPLOYMENT_FALLBACK` | Deployment usado para fallback. | Configuración de servidor. |
| `AZURE_OPENAI_API_VERSION` | Versión de API de Azure OpenAI. | Configuración de servidor. |
| `CONFIANZA_FALLBACK_THRESHOLD` | Umbral para activar fallback por baja confianza. | Configuración de servidor. |
| `APP_BUILD_TIME` | Fecha/hora ISO opcional del build o despliegue. | Metadata no sensible. |
| `APP_COMMIT_SHA` | Commit opcional mostrado en formato corto. | Metadata no sensible. |

Nunca se deben versionar `.env` o `.env.local`. Las claves de Azure y la service
role de Supabase no se importan en componentes cliente.

## Supabase

El repositorio no contiene una migración baseline que cree todo el esquema
original. Contiene migraciones incrementales que deben aplicarse en orden:

1. `docs/supabase-migrations/20260504_amparos_liquidacion_modificaciones.sql`
2. `docs/supabase-migrations/20260511_contratos_base_calculo_amparos.sql`
3. `docs/supabase-migrations/20260518_cotizaciones_versionamiento_emision.sql`
4. `docs/supabase-migrations/20260519_otrosies_endosos.sql`
5. `docs/supabase-migrations/20260527_contratos_renovacion.sql`
6. `docs/supabase-migrations/20260630_sprint4_prima_manual_eliminacion.sql`
7. `docs/supabase-migrations/20260630_sprint4_fix_documentos_tipo_documento_check.sql`
8. `docs/supabase-migrations/20260710_v041_resumen_overrides_cotizaciones.sql`

Los valores permitidos en `documentos.tipo_documento` deben mantenerse alineados
con `DOCUMENT_TYPES` de `lib/constants.ts` (`contrato_base`, `orden`,
`orden_compra`, `otrosi`). La base conserva `otro` como valor legacy.

Tablas utilizadas por el código:

- `clientes`
- `contratos`
- `documentos`
- `amparos`
- `extracciones`
- `tasas_referencia`
- `cotizaciones`
- `modificaciones_contractuales`
- `cotizaciones_ajuste`

Los IDs del dominio usan `bigint/int8`. Las relaciones nuevas con contratos usan
`contrato_id bigint references contratos(id)`.

### Storage

Debe existir un bucket privado llamado `contratos`. En él se guardan:

- documentos originales;
- PDFs de cotización base;
- PDFs de cotización de ajuste.

Las cargas, descargas y generación de PDF pasan por el servidor. La aplicación
no depende de almacenamiento persistente en el filesystem local.

### Registros y trazabilidad

| Evento | Registros afectados |
| --- | --- |
| Cargar contrato u orden | `clientes`, `contratos`, `documentos` y archivo en Storage. |
| Procesar documento base | `extracciones`, actualización de `contratos` y filas de `amparos`. |
| Validar revisión | actualización de `contratos` y reemplazo controlado de `amparos`. |
| Generar cotización base | nueva fila en `cotizaciones` y PDF en Storage. |
| Eliminar cotización no emitida | borrado definitivo de fila en `cotizaciones` y PDF asociado en Storage. |
| Emitir o revertir póliza base | actualización de estado y fechas en `cotizaciones`. |
| Cargar otrosí | `documentos` y nueva fila secuencial en `modificaciones_contractuales`. |
| Revisar otrosí | liquidación y snapshots en `modificaciones_contractuales`. |
| Generar cotización de ajuste | nueva fila en `cotizaciones_ajuste` y PDF en Storage. |
| Emitir o revertir otrosí | actualización coordinada de `cotizaciones_ajuste` y `modificaciones_contractuales`. |
| Eliminar contrato no emitido | borrado transaccional de dependencias; limpieza posterior de Storage. |

Las cotizaciones no se sobrescriben. Las versiones y emisiones revertidas se
conservan para trazabilidad.

## Cálculos y snapshots

La IA extrae datos y evidencia, pero no es la fuente final de los cálculos.
`lib/coverage-calculations.ts` calcula determinísticamente amparos base y
`lib/amendments.ts` calcula ajustes incrementales.

Las cotizaciones base y de ajuste guardan snapshots JSON. Las versiones
históricas no dependen de filas vivas que puedan cambiar después.

Reglas centrales:

- validar no crea versión;
- generar PDF crea versión;
- solo puede existir una póliza base emitida activa por contrato;
- solo puede existir una versión emitida activa por otrosí;
- una póliza emitida bloquea la validación directa del contrato;
- RCE/PLO genera una sola prima principal;
- los subamparos RCE son informativos;
- impuesto de timbre es una alerta y no forma parte de la prima.
- la prima manual, cuando está activa, reemplaza la prima neta automática y
  recalcula IVA y total.
- las fechas manuales por amparo solo aplican cuando su flag manual está activo.

## Scripts

```bash
npm run dev
npm run lint
npm test
npm run build
npm run start
```

`npm test` ejecuta las validaciones determinísticas de normalización, fechas,
vigencias, valores periódicos y liquidación incremental ubicadas en
`scripts/validate-normalizers.mjs`.

No hay todavía pruebas de navegador ni pruebas de integración contra Supabase.

## Despliegue

El proyecto está preparado para Azure App Service Linux con Node 22:

```bash
npm ci
npm run build
npm run start
```

La rama estable de despliegue es `main`. Las variables de entorno deben
configurarse en App Service; no deben incluirse en el repositorio.

En Azure el procesamiento de IA se ejecuta de forma síncrona dentro del Route
Handler. Para documentos grandes o concurrencia alta, el paso futuro recomendado
es mover extracción y procesamiento a una cola o worker durable.

## Seguridad y límites actuales

- No existe autenticación. El despliegue debe permanecer restringido hasta
  incorporar control de acceso.
- Los Route Handlers usan `SUPABASE_SERVICE_ROLE_KEY`; no deben exponerse como
  endpoints públicos sin protección.
- Los PDFs se reciben en memoria y no existe un límite explícito de tamaño en la
  aplicación.
- Varias operaciones combinan Storage y base de datos sin una transacción
  distribuida; un fallo intermedio puede requerir limpieza operativa.
- RLS debe mantenerse habilitado y sin políticas públicas para las tablas
  operadas mediante service role.

## Documentación

- [Arquitectura actual](./docs/ARCHITECTURE.md)
- [Sprint 1: auditoría inicial](./docs/Sprints/sprint_1_estado_actual_v1.md)
- [Sprint 2: cotización y emisión](./docs/Sprints/sprint_2_cotizacion_emision_afisec.md)
- [Sprint 3: otrosíes](./docs/Sprints/sprint_3_otrosies_endosos_afisec.md)
- [Sprint 4: estabilización](./docs/Sprints/Sprint_04_Estabilizacion_MVP_AFISEC.md)

Los documentos de Sprint conservan decisiones y referencias históricas. Cuando
una referencia del archivo Excel difiere de una regla aprobada posteriormente,
la regla implementada y sus pruebas determinísticas son la fuente técnica
vigente.
