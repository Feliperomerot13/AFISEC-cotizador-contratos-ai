# Sprint 4: Estabilización post-revisión AFISEC

## 1. Objetivo

Cerrar fricciones detectadas durante pruebas con el área usuaria sin cambiar la
arquitectura general ni reabrir cálculos ya validados.

El Sprint 4 fortalece:

- cobertura de páginas de Document Intelligence;
- tratamiento uniforme de documentos base;
- prima neta manual por amparo;
- edición de amparos agregados manualmente;
- eliminación segura de registros de prueba no emitidos;
- identificación visible de la versión desplegada.

## 2. Contexto de negocio

La prima automática se calcula desde valor asegurado, tasa y días. En operación
comercial puede existir una prima mínima definida fuera de la plataforma. Este
Sprint no implementa tarifarios por aseguradora; permite que la revisión humana
fije la prima neta final de un amparo y conserva el cálculo automático como
referencia.

También se requiere limpiar contratos cargados por error cuando nunca tuvieron
emisión, sin permitir que se pierda trazabilidad de pólizas u otrosíes emitidos.

## 3. Problemas identificados

1. El conteo `/Type /Page` podía incluir objetos históricos del PDF y producir
   falsos faltantes.
2. Orden de servicio y orden de compra seguían el flujo base, pero el subtipo no
   orientaba explícitamente el prompt.
3. La prima neta solo admitía cálculo automático.
4. Algunos inputs numéricos de amparos manuales utilizaban `type="number"`,
   limitando escritura parcial o valores con separadores.
5. No existía borrado físico protegido de contratos de prueba.
6. La interfaz no mostraba versión ni metadata de despliegue.

## 4. Decisiones técnicas

### 4.1 Conteo de páginas

Se distinguen dos fuentes:

- **Confiable:** `/Catalog -> /Pages -> /Count`.
- **Aproximada:** conteo de objetos `/Type /Page`.

La compuerta bloquea únicamente cuando el conteo confiable muestra una omisión
significativa. Una diferencia basada solo en objetos de página genera log interno
no bloqueante.

### 4.2 Documentos base

`contrato_base`, `orden` y `orden_compra` comparten el mismo modelo, pantallas,
schema y procesamiento. El subtipo se incorpora como instrucción contextual al
prompt. `otrosi` conserva su dispatch separado.

La versión de prompt cambia a `afisec-sprint4-v1` para conservar trazabilidad de
las extracciones realizadas con esta instrucción contextual.

### 4.3 Prima manual

`amparos` conserva:

- `prima_neta_automatica`;
- `usar_prima_neta_manual`;
- `prima_neta_manual`;
- `prima_neta`, `impuesto` y `prima_total` como valores finales.

Con override activo:

```text
prima_neta = prima_neta_manual
iva = prima_neta_manual * iva_porcentaje
prima_total = prima_neta_manual + iva
```

Cambios posteriores de tasa, fechas, días o valor asegurado recalculan la
referencia automática, pero no alteran la prima manual. Al desactivar el
override, la prima final vuelve a ser automática.

Los snapshots y PDFs consumen `prima_neta`, `impuesto` y `prima_total`; no
exponen los campos técnicos del override.

### 4.4 Eliminación

La eliminación usa confirmación exacta `ELIMINAR`.

La función PostgreSQL:

1. bloquea la fila del contrato;
2. rechaza pólizas con emisión activa o revertida;
3. rechaza otrosíes con emisión activa o revertida;
4. reúne las referencias de Storage;
5. elimina dependencias y contrato en una transacción;
6. devuelve los archivos que el backend debe retirar de Storage.

Storage se limpia después de confirmar el borrado de base. Si falla, la base
permanece consistente y la API devuelve advertencias de limpieza.

No se elimina automáticamente el cliente, porque puede estar relacionado con
otros contratos.

### 4.5 Versión

La aplicación queda identificada como:

- versión: `0.4.0`;
- release: `Sprint 4 · Estabilización`.

El dashboard muestra opcionalmente:

- `APP_BUILD_TIME`;
- `APP_COMMIT_SHA`, limitado a siete caracteres hexadecimales.

## 5. Alcance implementado

- conteo confiable y estimación no bloqueante;
- prueba 21 páginas extraídas frente a estimador frágil de 31;
- contexto de contrato, orden de servicio u orden de compra en IA;
- override de prima neta por amparo;
- referencia automática visible cuando hay override;
- inputs de porcentaje y días compatibles con escritura parcial;
- persistencia server-side de prima manual;
- eliminación física de contratos nunca emitidos;
- protección de toda emisión histórica;
- limpieza best-effort de documentos y PDFs en Storage;
- versión visible en dashboard;
- metadata opcional de build y commit.

## 6. Fuera de alcance

- tarifas o primas mínimas automáticas por aseguradora;
- autenticación, usuarios y roles;
- correo, WhatsApp o SMS;
- cúmulos y cupos;
- integración con SoftSeguros;
- migración de Supabase a servicios de datos de Azure;
- cambios en liquidación incremental de otrosíes;
- cambios en emisión o snapshots ya emitidos;
- rediseño general de la interfaz.

## 7. Archivos y módulos modificados

Procesamiento:

- `lib/ai.ts`
- `lib/processing.ts`

Prima manual:

- `lib/coverage-calculations.ts`
- `lib/schemas.ts`
- `lib/database.types.ts`
- `app/api/contracts/[id]/validate/route.ts`
- `components/contract-detail-client.tsx`

Eliminación:

- `app/api/contracts/[id]/route.ts`
- `components/contract-detail-client.tsx`

Versión:

- `package.json`
- `package-lock.json`
- `lib/constants.ts`
- `.env.example`
- `app/api/dashboard/route.ts`
- `components/dashboard-client.tsx`

Pruebas y documentación:

- `scripts/validate-normalizers.mjs`
- `README.md`
- `docs/ARCHITECTURE.md`
- este documento.

## 8. Migración

Archivo:

`docs/supabase-migrations/20260630_sprint4_prima_manual_eliminacion.sql`

Agrega columnas de prima manual y la función:

`public.eliminar_contrato_no_emitido(bigint)`

La función solo concede ejecución a `service_role`.

Hotfix posterior (mismo Sprint 4):

`docs/supabase-migrations/20260630_sprint4_fix_documentos_tipo_documento_check.sql`

Actualiza `documentos_tipo_documento_check` para permitir `orden` y
`orden_compra`, alineado con `DOCUMENT_TYPES`. Conserva `otro` como valor legacy.

## 9. Criterios de aceptación

### Document Intelligence

- 21 páginas extraídas no se bloquean por un estimador no confiable de 31.
- un conteo confiable con faltantes significativos mantiene el bloqueo.

### Documento base

- contrato, orden de servicio y orden de compra comparten flujo base;
- el subtipo llega al prompt;
- otrosí mantiene flujo separado.

### Prima manual

- el usuario activa el override por amparo;
- el IVA y total usan la prima manual;
- recalcular no sobrescribe el valor manual;
- desactivar restaura el cálculo automático;
- PDF y snapshot usan el valor final.

### Amparos manuales

- tipo, porcentaje, cuantía, valor asegurado, tasa, vigencia, días, fechas y
  prima manual son editables;
- los inputs aceptan escritura parcial;
- faltantes generan motivo de revisión.

### Eliminación

- un contrato nunca emitido puede eliminarse con confirmación fuerte;
- se eliminan dependencias y referencias de Storage;
- una emisión activa o histórica impide el borrado físico.

### Versión

- home muestra `v0.4.0` y `Sprint 4 · Estabilización`;
- build y commit aparecen solo cuando están configurados;
- no se exponen secretos.

## 10. Checklist de pruebas

- [x] Estimador frágil 31 / extracción 21 no bloquea.
- [x] Conteo confiable 31 / extracción 21 sí bloquea.
- [x] Conteo de catálogo 21 tiene prioridad sobre 31 objetos de página.
- [x] Prima manual recalcula IVA y total.
- [x] Desactivar override recupera prima automática.
- [x] Confirmación de eliminación exige `ELIMINAR`.
- [x] `npm run lint`.
- [x] `npm test`.
- [ ] Aplicar migración en Supabase de pruebas.
- [ ] Probar eliminación con archivos reales en Storage.
- [ ] Probar bloqueo de eliminación con emisión revertida.
- [ ] Validar visualmente PDF con prima manual.
- [x] `npm run build`.

## 11. Notas de despliegue

1. Aplicar la migración Sprint 4 antes de desplegar el código.
2. Configurar opcionalmente `APP_BUILD_TIME` en formato ISO.
3. Configurar opcionalmente `APP_COMMIT_SHA` con el SHA del despliegue.
4. Desplegar desde `main` con Node 22.
5. Confirmar en home que aparece `v0.4.0`.

## 12. Riesgos y pendientes

- No hay pruebas de integración contra Supabase; la función de eliminación debe
  probarse primero en ambiente de pruebas.
- Storage no participa en la transacción PostgreSQL. Un fallo de limpieza deja
  archivo huérfano, pero no referencias rotas en la base.
- La aplicación sigue sin autenticación; el endpoint de eliminación no debe
  exponerse fuera de un entorno restringido.
- Los PDFs grandes siguen cargándose en memoria.
- Un módulo futuro de aseguradoras deberá reutilizar el override manual sin
  convertirlo prematuramente en una regla automática.
