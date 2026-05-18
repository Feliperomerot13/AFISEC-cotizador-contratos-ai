# Sprint: Cotización, versionamiento, emisión y cierre visual de la V1

## 1. Propósito del sprint

Este sprint tiene como objetivo cerrar el primer mínimo viable del sistema AFISEC para contratos base, órdenes de compra y órdenes de servicio. El sistema ya permite cargar documentos, extraer información con IA, revisar datos contractuales y liquidar amparos. Ahora debe completar el ciclo comercial inicial: revisar, validar, generar cotización, versionar cotizaciones, marcar emisión de póliza y presentar una interfaz institucional coherente con la marca AFISEC.

Este sprint no incluye otrosíes. La lógica de otrosíes debe partir de una póliza emitida, por lo tanto primero se necesita definir y cerrar el flujo de cotización y emisión de la póliza base.

## 2. Alcance funcional

El alcance de este sprint incluye:

1. Definir el flujo de estados de la cotización y la póliza base.
2. Permitir generar cotizaciones PDF a partir de información validada.
3. Versionar cotizaciones generadas para un mismo contrato u orden.
4. Permitir marcar una cotización como emitida cuando la póliza haya sido expedida por la aseguradora.
5. Bloquear o limitar la edición de una póliza emitida.
6. Mostrar un resumen claro de la póliza emitida.
7. Permitir anular o revertir una emisión de forma controlada.
8. Ajustar la interfaz general al lineamiento visual de AFISEC.
9. Incorporar logo, colores, lenguaje institucional y consistencia visual en las principales pantallas.

## 3. Fuera de alcance

Este sprint no debe implementar:

- Otrosíes.
- Endosos.
- Cúmulo.
- Cupos por cliente.
- Estado de póliza para cálculo de cúmulo.
- Pantalla avanzada de contratos con filtros comerciales.
- Histórico tipo Excel.
- Integración con aseguradoras.
- Envío automático de correo.
- Autenticación y permisos.
- Integración con Softseguros u otros sistemas externos.

## 4. Flujo de negocio esperado

El flujo comercial correcto es:

1. Se carga un contrato, orden de compra u orden de servicio.
2. La IA extrae información relevante.
3. La comercial revisa y corrige datos generales, base de cálculo, fechas, amparos, tasas y primas.
4. La comercial valida la revisión interna.
5. Desde la información validada se genera una cotización PDF.
6. La cotización se envía al cliente.
7. Si el cliente solicita cambios, la comercial vuelve a editar, valida nuevamente y genera una nueva versión de cotización.
8. Cuando el cliente aprueba, la comercial emite la póliza en la aseguradora externa.
9. Una vez expedida y pagada o confirmada la póliza, la comercial marca la póliza como emitida en la plataforma.
10. A partir de la emisión, la póliza base queda bloqueada como punto de verdad.
11. En un sprint posterior, los otrosíes modificarán esa póliza emitida.

## 5. Estados propuestos

El sistema debe distinguir entre revisión interna, cotización documental y póliza emitida.

### 5.1 Borrador

Estado posterior al procesamiento con IA.

Características:

- Información editable.
- Puede tener campos pendientes o en revisión.
- No se debe generar una cotización final si existen errores críticos sin resolver.
- Puede mostrar alertas, fuentes, motivos de revisión y campos internos.

### 5.2 Validada

Estado en el que la comercial ya revisó la información y considera que está lista para cotizar.

Características:

- Sigue siendo editable.
- Se puede validar más de una vez.
- Validar no necesariamente crea una nueva versión documental.
- Sirve como requisito para generar cotización PDF.

### 5.3 Cotización generada

Estado documental que aparece cuando se genera un PDF de cotización.

Características:

- Cada generación de PDF crea una versión de cotización.
- La versión debe conservar una foto de los valores cotizados en ese momento.
- Si el cliente pide cambios, se edita la información, se valida de nuevo y se genera una nueva versión.

### 5.4 Emitida

Estado en el que la póliza ya fue expedida por la aseguradora con los valores, amparos, vigencias y primas definidos.

Características:

- Debe bloquearse la edición directa de la estructura base emitida.
- Debe conservarse el snapshot de lo emitido.
- Debe servir como base para futuros otrosíes.
- Debe poder visualizarse como resumen de póliza emitida, no como formulario editable.

### 5.5 Anulada o emisión revertida

Estado opcional para corregir errores operativos.

Características:

- Permite excluir la póliza de futuros cálculos de cúmulo.
- No debería borrar la trazabilidad.
- Se usa cuando se marcó como emitida por error, el cliente no pagó o se reemplazó por otra versión.

## 6. Regla clave de versionamiento

La versión debe crearse al generar la cotización PDF, no cada vez que se valida internamente.

Razón:

- Validar es una acción interna.
- Generar PDF es una acción documental que produce algo que puede enviarse al cliente.
- El historial relevante para cliente es el de cotizaciones generadas, no cada validación interna.

Ejemplo:

- COT-2026-0001 v1
- COT-2026-0001 v2
- COT-2026-0001 v3

La cotización mantiene el mismo número base y aumenta la versión cuando se vuelve a generar para el mismo contrato u orden.

## 7. Cotización PDF

### 7.1 Momento de generación

La cotización PDF debe generarse desde una revisión validada. Si existen campos críticos pendientes, el sistema debe advertir al usuario o impedir la generación según el nivel de riesgo.

### 7.2 Contenido que debe incluir

El PDF debe ser un documento comercial para enviar al cliente.

Debe incluir:

- Encabezado institucional de AFISEC.
- Logo de AFISEC.
- Nombre legal o comercial de AFISEC.
- Número de cotización.
- Versión de cotización.
- Fecha de emisión de la cotización.
- Cliente.
- NIT o identificación del cliente.
- Número de contrato, orden de compra u orden de servicio.
- Contratante.
- Contratista.
- Objeto resumido.
- Valor del contrato u orden usado como base.
- Indicación de si la base incluye IVA cuando aplique.
- Tabla de amparos cotizados.
- Valor asegurado por amparo.
- Vigencia desde.
- Vigencia hasta.
- Prima neta.
- IVA.
- Prima total.
- Total prima neta.
- Total IVA.
- Total cotización.
- Observaciones comerciales.
- Nota de sujeción a aprobación final de aseguradora, cuando aplique.

### 7.3 Contenido que no debe incluir

El PDF no debe incluir:

- Tasa.
- Fuente textual del contrato.
- Página de extracción.
- Confianza IA.
- Motivo de revisión.
- JSON.
- Prompts.
- Campos técnicos internos.
- Nombre “Muñeco”.
- Lenguaje de prototipo o MVP.

La tasa se considera un dato interno de negociación y no debe mostrarse al cliente.

### 7.4 Observaciones comerciales sugeridas

El PDF puede incluir observaciones como:

- “Cotización sujeta a revisión y aprobación final de la aseguradora.”
- “Los valores podrán variar si se modifican las condiciones del contrato, vigencias, amparos o valores asegurados.”
- “Esta cotización no constituye póliza emitida ni cobertura vigente hasta su expedición formal por la aseguradora.”

## 8. Emisión de póliza

### 8.1 Acción de emisión

Debe existir una acción clara:

“Marcar como emitida”

Esta acción se usa después de que el cliente aprueba la cotización y la comercial emite la póliza en el portal de la aseguradora.

### 8.2 Efecto de marcar como emitida

Al marcar como emitida, el sistema debe:

- Registrar qué cotización o versión fue usada para emitir.
- Congelar los valores emitidos.
- Congelar amparos, vigencias, primas y totales emitidos.
- Cambiar el modo visual a “póliza emitida”.
- Bloquear la edición directa de la póliza base.
- Dejar habilitada una acción futura para cargar otrosíes.

### 8.3 Edición posterior a emisión

Una póliza emitida no debería editarse directamente como borrador.

Si hubo un error operativo, debe existir una acción controlada:

- “Anular emisión”
- “Revertir emisión”

Esta acción debe permitir volver a trabajar una nueva versión sin borrar la trazabilidad.

## 9. Resumen de póliza emitida

Cuando una póliza está emitida, la pantalla no debe seguir pareciendo un formulario editable completo.

Debe mostrar un resumen ejecutivo:

- Estado: Emitida.
- Cliente.
- Contrato u orden.
- Fecha de emisión en plataforma.
- Cotización usada para emisión.
- Valor contrato u orden.
- Amparos emitidos.
- Valores asegurados.
- Vigencias.
- Prima neta.
- IVA.
- Prima total.
- Total de la póliza.

Acciones visibles:

- Ver o descargar cotización PDF.
- Anular o revertir emisión.
- Cargar otrosí en sprint posterior.

Los detalles técnicos de IA, fuentes y motivos de revisión deben quedar ocultos o colapsados.

## 10. Interfaz y lineamiento visual AFISEC

Este sprint también debe cerrar la experiencia visual mínima de la V1.

### 10.1 Objetivo visual

La aplicación debe sentirse como una herramienta institucional de AFISEC, no como un prototipo técnico.

Debe evitar:

- “MVP”.
- “Muñeco”.
- Lenguaje experimental.
- Textos internos del equipo técnico.
- Estilos inconsistentes entre pantallas.

### 10.2 Pantallas que deben revisarse

El ajuste visual no debe limitarse al inicio. Debe revisar:

- Página de inicio.
- Página de carga de documentos.
- Página de lista de contratos.
- Página de detalle y revisión.
- Secciones de amparos.
- Estados y botones principales.
- PDF de cotización.

### 10.3 Elementos visuales esperados

Incluir:

- Logo de AFISEC si está disponible.
- Colores institucionales.
- Botones consistentes.
- Badges de estado claros.
- Encabezados sobrios.
- Tipografía legible.
- Espaciado limpio.
- Tablas fáciles de leer.
- Formato monetario con separador de miles.
- Fechas en formato comprensible.

### 10.4 Colores

Si existe logo o asset oficial en el proyecto, los colores deben derivarse de ahí.

Si no hay fuente oficial, se pueden usar como base provisional:

- Naranja AFISEC: #F58220
- Verde/teal AFISEC: #008C7A
- Texto principal: #111111
- Fondo claro: #F6F7F8

No se debe saturar la interfaz con naranja. El naranja debe funcionar como acento para acciones principales, estados destacados o elementos de marca.

## 11. Funcionalidades concretas del sprint

### 11.1 Generar cotización PDF

Agregar acción en ficha de contrato u orden:

“Generar cotización PDF”

Condiciones:

- Debe estar validada o sin errores críticos.
- Debe tomar los datos revisados actuales.
- Debe crear una versión de cotización.
- Debe permitir descargar el PDF.

### 11.2 Listar cotizaciones generadas

En la ficha debe existir una sección:

“Cotizaciones generadas”

Debe mostrar:

- Número de cotización.
- Versión.
- Fecha de generación.
- Estado.
- Total cotización.
- Acción para descargar PDF.

### 11.3 Crear nueva versión

Si se generan cambios después de una cotización, al volver a generar PDF debe crearse una versión nueva.

Regla:

- No sobrescribir la versión anterior.
- Mantener trazabilidad.

### 11.4 Marcar como emitida

Desde una cotización generada debe poder marcarse como emitida.

Debe quedar claro cuál versión fue emitida.

### 11.5 Bloqueo de póliza emitida

Al emitir:

- No permitir edición directa de amparos base.
- No permitir cambios silenciosos en valor contrato, vigencias o primas.
- Mostrar resumen bloqueado.

### 11.6 Anular o revertir emisión

Permitir una acción flexible para la V1:

- Si se emitió por error.
- Si el cliente no pagó.
- Si se reemplazó por otra versión.

La acción no debe borrar datos sin trazabilidad.

## 12. Datos que deben conservarse en una cotización

Cada cotización generada debe conservar, como mínimo:

- Contrato u orden asociada.
- Cliente.
- Número de cotización.
- Versión.
- Fecha de generación.
- Usuario o responsable si existe.
- Estado de la cotización.
- Snapshot de datos generales.
- Snapshot de amparos cotizados.
- Totales.
- Ruta o referencia al PDF si se guarda.

No se debe depender únicamente de los datos vivos del contrato, porque esos pueden cambiar si se genera una nueva versión.

## 13. Relación futura con otrosíes

La lógica de otrosíes debe quedar fuera de este sprint, pero este sprint debe preparar la base conceptual:

- Un otrosí solo debería operar sobre una póliza emitida.
- Una póliza emitida es el punto de verdad.
- El otrosí debe modificar valores, vigencias o condiciones emitidas.
- El otrosí no debe trabajar sobre un borrador editable.

## 14. Relación futura con cúmulo

El cúmulo no se implementa en este sprint, pero la emisión deja la base para hacerlo después.

En el futuro, el cúmulo debe considerar:

- Pólizas emitidas.
- Vigentes a la fecha.
- No anuladas.
- Valores asegurados vigentes.

Las cotizaciones no deben consumir cúmulo.

## 15. Criterios de aceptación

El sprint se considera terminado cuando se pueda hacer este flujo completo:

1. Cargar contrato u orden base.
2. Procesar con IA.
3. Revisar y corregir datos.
4. Validar internamente.
5. Generar cotización PDF v1.
6. Descargar PDF.
7. Ver cotización listada en la ficha.
8. Modificar algún dato antes de emisión.
9. Validar nuevamente.
10. Generar cotización PDF v2.
11. Confirmar que v1 sigue existiendo.
12. Marcar v2 como emitida.
13. Ver la póliza en modo emitido/bloqueado.
14. Confirmar que el PDF no muestra tasa ni fuentes internas.
15. Confirmar que la interfaz tiene lineamiento AFISEC en inicio, carga, lista y detalle.
16. Confirmar que no se implementó otrosí ni cúmulo.

## 16. Casos de prueba mínimos

### Caso 1: Contrato base 004

Validar:

- Valor contrato correcto.
- Fecha inicio y fecha fin correctas.
- Amparos calculados correctamente.
- Cotización PDF generada.
- Versión creada.
- Emisión bloquea edición.

### Caso 2: Contrato 011

Validar:

- Anticipo correcto.
- RCE/PLO correcto.
- Acta de Inicio pendiente correctamente tratada.
- Cotización no debe generarse si faltan fechas críticas sin confirmación o debe advertirlo claramente.

### Caso 3: Orden de compra 226-2026

Validar:

- Documento tipo orden funciona como base contractual.
- Valor con IVA incluido correcto.
- Plazo dependiente de notificación de inicio.
- Tres amparos principales.
- Cotización PDF generada con lenguaje correcto.

## 17. Validaciones técnicas esperadas

Antes de cerrar el sprint deben ejecutarse:

```bash
npm run lint
npm test
npm run build
```

Además, se debe entregar un resumen de diff:

- Archivos modificados.
- Razón de cada modificación.
- Comportamiento nuevo.
- Comportamiento preservado.
- Migraciones creadas, si aplica.
- Riesgos pendientes.
- Qué no se pudo verificar.

## 18. Riesgos a controlar

### 18.1 Sobredimensionamiento

Evitar crear una arquitectura de emisión demasiado compleja. La V1 necesita versionamiento simple, PDF y estado de emisión, no un sistema completo de pólizas.

### 18.2 Mezcla con otrosíes

No implementar lógica de otrosí en este sprint.

### 18.3 Edición de póliza emitida

Evitar que una póliza emitida se pueda modificar silenciosamente.

### 18.4 PDF con información interna

Evitar incluir tasa, fuentes, confianza IA o notas internas.

### 18.5 Interfaz parcial

No limitar la mejora visual a la página de inicio. La experiencia debe ser consistente en las pantallas principales.

## 19. Recomendación para trabajar con Codex

Antes de implementar, pedir a Codex:

1. Auditoría rápida del estado actual.
2. Plan mínimo para este sprint.
3. Archivos que tocaría.
4. Si requiere migración y por qué.
5. Cómo manejaría PDF y versiones.
6. Cómo bloquearía emisión sin sobredimensionar.

Codex no debe implementar hasta que el plan sea revisado.

## 20. Resumen ejecutivo

Este sprint cierra la primera V1 comercial de AFISEC: desde la carga y revisión de un contrato base hasta la generación de cotización y la marca de póliza emitida. La cotización es editable y versionable antes de emitir. La póliza emitida queda bloqueada y se convierte en la base futura para otrosíes, cúmulo y seguimiento de cliente.

