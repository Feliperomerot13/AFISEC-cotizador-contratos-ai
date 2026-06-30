# Sprint 3: Otrosíes y cotización de ajuste sobre póliza emitida

> **Estado documental:** Sprint implementado. Las secciones 1 a 19 conservan la
> propuesta técnica y las referencias funcionales previas. La sección 20
> documenta el resultado implementado. En la experiencia visible se usa
> `Otrosí`; `endoso_emitido` y `amendment` permanecen únicamente como nombres
> técnicos históricos para evitar una migración o refactor de riesgo.

## 1. Propósito del sprint

El Sprint 3 debe habilitar el flujo de otrosíes y endosos sobre pólizas base ya emitidas en AFISEC. El objetivo no es volver a cotizar el contrato completo desde cero, sino revisar un delta contractual, liquidar el ajuste incremental correspondiente, generar una cotización de ajuste versionada y, si se aprueba, emitir un endoso que actualice el estado vigente de la póliza.

Este sprint parte de la V1 posterior al Sprint 2:

- carga de contratos, órdenes de compra y órdenes de servicio;
- extracción IA y revisión humana;
- cálculo de amparos base;
- generación de cotizaciones PDF versionadas;
- emisión y bloqueo de póliza base;
- historial de cotizaciones y resumen de póliza emitida.

Regla central: un otrosí solo puede operar sobre un contrato u orden con póliza base emitida activa. El otrosí no modifica borradores ni edita directamente la póliza base; produce una cotización de ajuste y, después de emitirse, un endoso trazable.

## 2. Flujo de negocio

Flujo recomendado:

1. Seleccionar cliente.
2. Seleccionar contrato u orden específica.
3. Confirmar que existe póliza base emitida activa.
4. Confirmar que no existe un otrosí anterior pendiente sin emitir, salvo que esté anulado o marcado como no aplicable.
5. Cargar PDF del otrosí o seleccionar documento ya cargado.
6. Asociar el documento al contrato y al estado vigente de la póliza.
7. Extraer con IA únicamente el delta del otrosí.
8. Mostrar pantalla de revisión editable.
9. Validar datos del otrosí y corregir fechas, valores, tasas o alertas.
10. Calcular liquidación incremental contra el estado vigente anterior.
11. Generar cotización de ajuste versionada.
12. Permitir emitir el endoso desde una versión de cotización de ajuste.
13. Al emitir, congelar snapshot del ajuste y del estado vigente resultante.
14. Mostrar histórico secuencial de póliza base y endosos.
15. Permitir que el siguiente otrosí parta del último endoso emitido.

El estado vigente debe derivarse así:

1. Si no hay endosos emitidos, el estado vigente es la póliza base emitida.
2. Si hay endosos emitidos, el estado vigente es el snapshot resultante del último endoso emitido.
3. Si hay un otrosí pendiente, no se debe procesar el siguiente otrosí hasta emitirlo, anularlo o marcarlo como no aplicable.

## 3. Estados

### 3.1 Estados de otrosí

Estados sugeridos para `modificaciones_contractuales.estado`:

- `cargado`: documento registrado, sin extracción terminada.
- `procesando`: extracción IA en curso.
- `pendiente_revision`: delta extraído y listo para revisión humana.
- `validado`: revisión interna confirmada; puede generar cotización de ajuste.
- `cotizado`: existe al menos una cotización de ajuste generada.
- `endoso_emitido`: un ajuste fue emitido y actualiza el estado vigente.
- `no_aplicable`: el otrosí no genera ajuste asegurable o no debe aplicarse.
- `anulado`: registro cerrado por error operativo o decisión comercial.
- `error`: extracción o procesamiento falló.

### 3.2 Estados de cotización de ajuste

Estados sugeridos para una tabla separada `cotizaciones_ajuste`:

- `generada`: PDF de ajuste creado y versionado.
- `endoso_emitido`: versión usada para emitir endoso.
- `emision_revertida`: emisión revertida sin borrar trazabilidad.
- `anulada`: cotización de ajuste cerrada por decisión operativa.

### 3.3 Estados terminales

Estados terminales para permitir procesar el siguiente otrosí:

- `endoso_emitido`;
- `no_aplicable`;
- `anulado`.

Mientras exista un otrosí en `cargado`, `procesando`, `pendiente_revision`, `validado` o `cotizado`, el sistema debe bloquear el procesamiento del siguiente otrosí para el mismo contrato.

## 4. Tipos de otrosí

El sprint debe soportar o dejar preparado:

- prórroga de plazo;
- adición de valor;
- adición + prórroga;
- cambio de objeto;
- ajuste de garantías;
- modificación sin impacto asegurable;
- ajuste de saldos o ajuste sin prima;
- RCE/PLO con subamparos informativos.

Clasificación funcional mínima:

| Tipo | Impacto esperado | Liquidación |
| --- | --- | --- |
| Prórroga de plazo | Extiende vigencias sobre valores asegurados vigentes o acumulados. | Prima por prórroga. |
| Adición de valor | Aumenta valor asegurado desde la fecha del otrosí o vigencia aplicable. | Prima por valor adicionado. |
| Adición + prórroga | Aumenta valor y extiende plazo. | Prima por valor adicionado + prima por prórroga. |
| Cambio de objeto | Puede requerir revisión de garantías. | No genera prima automática salvo ajuste asegurable. |
| Ajuste de garantías | Cambia amparos, porcentajes, vigencias o subamparos. | Depende del delta aprobado. |
| Sin impacto asegurable | Cambia datos no asegurables. | Sin prima; puede marcarse no aplicable. |
| Ajuste de saldos | Corrige valores sin alterar obligación asegurable. | Puede ser sin prima o prima manual revisada. |

## 5. Datos a extraer

La IA debe extraer delta, no reinterpretar el contrato completo. El prompt y el schema de otrosí deben concentrarse en lo que cambia frente al estado vigente.

Campos esperados:

- número de otrosí;
- contrato afectado;
- fecha de firma;
- valor contrato anterior;
- valor adicionado;
- valor acumulado;
- fecha fin anterior;
- nueva fecha fin;
- días de prórroga;
- cambio de objeto;
- objeto nuevo;
- si exige ajuste de garantías;
- cláusulas relevantes;
- impuesto de timbre como alerta o campo informativo;
- fuente página;
- fuente texto;
- confianza;
- alertas;
- campos no encontrados.

Reglas de extracción:

- Si el documento menciona impuesto de timbre, guardarlo como alerta/informativo. No mezclarlo con prima de póliza.
- Si el otrosí no menciona valor adicionado ni nueva fecha fin, marcar posible `modificacion_sin_impacto_asegurable`.
- Si la fecha fin nueva difiere de los días de prórroga explícitos, conservar ambos datos y generar alerta.
- Si el documento menciona garantías o pólizas, priorizar esas cláusulas para revisión humana.
- Si el contrato afectado no coincide con el contrato seleccionado, bloquear o marcar alerta crítica.

## 6. Pantalla de revisión

Debe existir una pantalla editable antes de calcular, cotizar o emitir.

Campos editables mínimos:

- número de otrosí;
- tipo de modificación;
- fecha de firma;
- valor contrato anterior;
- valor adicionado;
- valor acumulado;
- fecha fin anterior;
- nueva fecha fin;
- días de prórroga;
- objeto anterior;
- objeto nuevo;
- requiere ajuste de garantías;
- observaciones;
- alertas;
- tasas por amparo cuando aplique.

Comportamiento esperado:

- Fechas, valores, porcentajes, días y tasas deben poder corregirse manualmente.
- Al cambiar valores o fechas, la liquidación incremental debe recalcularse automáticamente.
- Si los días calculados por fechas difieren del texto del otrosí o del dato manual, mostrar alerta y permitir decisión humana.
- La pantalla debe mostrar el estado vigente anterior: valor asegurado vigente, fecha fin vigente, amparos vigentes y primas base/endosos anteriores.
- No mostrar prompts, JSON ni fuentes internas en documentos comerciales. Fuentes y confianza pueden verse solo en modo revisión interna.

## 7. Liquidación incremental

La liquidación de otrosí no debe generar una póliza completa desde cero. Debe calcular el ajuste contra la póliza/endoso vigente.

Para amparos porcentuales:

- valor asegurado vigente = valor asegurado antes del otrosí;
- valor asegurado de la adición = valor adicionado x porcentaje del amparo;
- valor asegurado acumulado = valor acumulado x porcentaje del amparo;
- prima por valor adicionado = valor asegurado de la adición x tasa x días de vigencia total del nuevo amparo / 365;
- prima por prórroga = valor asegurado acumulado x tasa x días de prórroga / 365;
- prima total del ajuste = prima por valor adicionado + prima por prórroga;
- IVA = prima total del ajuste x porcentaje IVA;
- total = prima total del ajuste + IVA.

Nombres obligatorios en UI y PDF:

- Prima por valor adicionado.
- Prima por prórroga.
- Prima total ajuste.

Consideraciones:

- Si solo hay prórroga, `valor asegurado de la adición` puede ser cero.
- Si solo hay adición, `prima por prórroga` puede ser cero.
- Si no hay valor ni plazo asegurable, el resultado puede ser sin prima y requerir marca `no_aplicable`.
- El cálculo debe ser auditable y no depender ciegamente de encabezados ambiguos del Excel de referencia.
- La tasa puede ser editable en revisión, pero no debe mostrarse en PDFs comerciales.
- La liquidación debe guardar snapshot de insumos y resultados para trazabilidad.

## 8. RCE/PLO y subamparos

RCE/PLO conserva la misma regla conceptual del contrato base:

- RCE/PLO es una línea principal calculable.
- Los subamparos son informativos y no generan prima individual.
- PLO puede representar el subamparo calculable principal cuando el documento lo expresa así.
- Si la cuantía PLO no cambia, liquidar solo la prórroga sobre la cuantía vigente.
- Si la cuantía PLO cambia, liquidar ajuste por nueva cuantía.
- Si el otrosí agrega o elimina subamparos informativos, mostrarlo como cambio revisable.
- Mostrar subamparos incluidos en la cotización de ajuste y en el resumen del endoso.
- No duplicar primas por subamparos.

Campos recomendados en snapshot de ajuste RCE:

- cuantía RCE/PLO vigente;
- cuantía RCE/PLO nueva;
- prima por adición de cuantía;
- prima por prórroga;
- subamparos incluidos;
- subamparos agregados;
- subamparos retirados;
- alerta si falta cuantía principal.

## 9. Cotización de ajuste

El otrosí debe generar cotización propia de ajuste/endoso, independiente de la cotización base.

Versionamiento esperado:

- Cotización ajuste Otrosí 1 v1.
- Cotización ajuste Otrosí 1 v2.
- Cotización ajuste Otrosí 2 v1.
- Cotización ajuste Otrosí 3 v1.

Reglas:

- La versión nace cuando se genera el PDF de ajuste.
- Validar internamente el otrosí no crea versión.
- Cada otrosí tiene su propio contador de versiones.
- Versiones anteriores no deben cambiar si se edita la revisión del otrosí y se genera una nueva versión.
- La cotización de ajuste debe guardar snapshot del estado vigente anterior, delta revisado, liquidación y estado vigente resultante propuesto.

PDF de ajuste debe incluir:

- AFISEC;
- contrato afectado;
- póliza/cotización base emitida afectada;
- número de otrosí;
- fecha del otrosí;
- valor anterior;
- valor adicionado;
- valor acumulado;
- fecha fin anterior;
- nueva fecha fin;
- días de prórroga;
- tabla de ajuste por amparo;
- valor asegurado vigente;
- valor asegurado adición;
- valor asegurado acumulado;
- prima por valor adicionado;
- prima por prórroga;
- prima total ajuste;
- IVA;
- total;
- RCE/PLO y subamparos si aplica;
- observaciones comerciales.

El PDF no debe incluir:

- tasa;
- fuentes internas;
- confianza IA;
- JSON;
- prompts;
- motivos internos de revisión;
- lenguaje de prototipo;
- nombres internos del sistema.

## 10. Emisión de endoso

Debe existir acción explícita:

`Marcar endoso como emitido`

Al emitir:

- congelar snapshot del ajuste;
- marcar la cotización de ajuste seleccionada como `endoso_emitido`;
- marcar el otrosí como `endoso_emitido`;
- registrar fecha de emisión;
- registrar usuario o ejecutiva si está disponible;
- definir el snapshot resultante como estado vigente para futuros otrosíes;
- conservar histórico de póliza base y endosos anteriores;
- permitir cargar el siguiente otrosí desde el nuevo estado vigente.

Reversión/anulación:

- Debe existir reversión/anulación de endoso sin borrar trazabilidad.
- Revertir un endoso debe impedir usarlo como estado vigente.
- Si se revierte el último endoso, el estado vigente vuelve al endoso emitido anterior o a la póliza base.
- No debe permitirse revertir un endoso intermedio si existen endosos posteriores activos, salvo flujo explícito de anulación encadenada.

## 11. Histórico

Debe mostrarse una línea de tiempo o tabla con:

- póliza base emitida;
- otrosí/endoso 1;
- otrosí/endoso 2;
- otrosí/endoso 3;
- siguientes endosos.

Cada fila debe mostrar:

- tipo;
- número;
- fecha;
- valor anterior;
- valor adicionado;
- valor acumulado;
- fecha fin anterior;
- nueva fecha fin;
- prima ajuste;
- estado;
- PDF.

Estados visibles sugeridos:

- Póliza base emitida.
- Otrosí pendiente de revisión.
- Cotización de ajuste generada.
- Endoso emitido.
- No aplicable.
- Anulado.
- Error de procesamiento.

## 12. Fuera de alcance

No implementar en este sprint:

- cúmulo;
- cupos por cliente;
- reportes gerenciales;
- filtros avanzados;
- integración directa con aseguradoras;
- envío automático por correo;
- autenticación o roles;
- edición masiva de endosos;
- lectura automática del Excel de referencia como fuente de verdad;
- recalcular o modificar lógica de contrato base;
- rediseñar extracción base;
- rediseñar cálculo base de amparos;
- cambiar lógica base de anticipo;
- cambiar lógica base RCE/PLO;
- cambiar helpers date-only ya probados.

## 13. Riesgos

Riesgos principales:

- Confundir cotización base con cotización de ajuste y romper el versionamiento del Sprint 2.
- Usar datos vivos de `contratos` y `amparos` en vez de snapshots emitidos.
- Procesar Otrosí 2 antes de cerrar Otrosí 1.
- Sobrescribir póliza base emitida en vez de crear endoso trazable.
- Mezclar impuesto de timbre con prima.
- Duplicar prima de RCE por subamparos informativos.
- Tocar lógica base de fechas al intentar resolver prórrogas.
- La migración histórica `20260504_amparos_liquidacion_modificaciones.sql` documenta `uuid`, pero el esquema real actual usa `bigint/int8`; Sprint 3 debe crear migración correctiva/no destructiva alineada a `bigint`.
- `components/contract-detail-client.tsx` ya es un componente grande; agregar todo el flujo allí aumentaría fragilidad.
- Los documentos de referencia funcional no están versionados en el repo; sin ellos, los casos Otrosí 1, 2 y 3 pueden quedar incompletos.

Mitigaciones:

- Crear helpers nuevos para estado vigente, delta de otrosí y liquidación incremental.
- Mantener contratos base, cotizaciones base y PDF base aislados.
- Usar snapshots para cotización de ajuste y endoso emitido.
- Agregar validaciones de secuencia en backend y UI.
- Implementar primero modelo y revisión antes de PDF/endoso.

## 14. Criterios de aceptación

El sprint estará aceptado cuando:

- No se pueda cargar/procesar un otrosí sin póliza base emitida activa.
- El sistema bloquee Otrosí 2 si Otrosí 1 está pendiente.
- Un otrosí pueda cargarse, extraerse y revisarse como delta editable.
- La revisión permita editar fechas, valores, días, objeto, ajuste de garantías y tasas.
- La liquidación incremental muestre prima por valor adicionado, prima por prórroga y prima total ajuste.
- La cotización de ajuste se genere como PDF versionado.
- La versión se cree solo al generar PDF.
- Una versión anterior conserve su snapshot aunque se edite el otrosí.
- El PDF de ajuste no muestre tasa ni datos internos.
- RCE/PLO se muestre como línea principal con subamparos informativos.
- Emitir el endoso actualice el estado vigente usado por el siguiente otrosí.
- El histórico muestre póliza base y endosos en orden.
- Se pueda revertir/anular un endoso sin borrar trazabilidad.
- Contratos base y cotización base del Sprint 2 sigan funcionando.

## 15. Casos de prueba con Otrosí 1, 2 y 3

Los casos deben ejecutarse con los documentos funcionales versionados en `docs/Sprints/referencias_otrosies/`. Aunque esta sección conserva el nombre original, el set actual de referencias contiene contrato base, Otrosí 1, Otrosí 2, Otrosí 3, Otrosí 4 y la liquidación exportada del archivo de trabajo. No se encontró un archivo separado de Otrosí 5.

### Otrosí 1

Referencia:

- `docs/Sprints/referencias_otrosies/Otrosi No.1 (1).pdf`
- `docs/Sprints/referencias_otrosies/COTIZACION -LIQUIDACION (1).xlsx.pdf`

Objetivo:

- validar carga sobre póliza emitida;
- extraer número de otrosí, valor adicionado de `$203.093.584`, nueva fecha fin `02/03/2025`, cambio de objeto de seis a cinco grúas y cláusula de ajuste de garantías;
- calcular ajuste incremental desde póliza base.

Pruebas:

- Generar Cotización ajuste Otrosí 1 v1.
- Validar que la liquidación use valor acumulado esperado `$2.723.362.587`.
- Validar que la liquidación del archivo de referencia muestra prima total de garantías `$895.493` y RCE `$236.370`.
- Editar un valor revisado y generar v2.
- Confirmar que v1 mantiene snapshot anterior.
- Emitir endoso 1.
- Confirmar que el estado vigente resultante cambia para el siguiente otrosí.

### Otrosí 2

Referencia:

- `docs/Sprints/referencias_otrosies/Otrosi No.2 (1).pdf`
- `docs/Sprints/referencias_otrosies/COTIZACION -LIQUIDACION (1).xlsx.pdf`

Objetivo:

- confirmar secuencia;
- partir del endoso 1 emitido, no de la póliza base original;
- bloquear si Otrosí 1 no está emitido o marcado terminal.

Pruebas:

- Intentar procesar Otrosí 2 con Otrosí 1 pendiente: debe bloquear.
- Emitir o anular Otrosí 1.
- Procesar Otrosí 2.
- Extraer desde documento escaneado valor adicionado `$203.093.584`, fecha fin anterior `02/03/2025`, nueva fecha fin `02/04/2025` y ajuste de garantías.
- Validar que la liquidación use valor acumulado esperado `$2.926.456.171`.
- Validar que la liquidación del archivo de referencia muestra prima total de garantías `$963.676` y RCE `$244.521`.
- Verificar que valores anteriores y fecha fin anterior provienen del endoso 1.

### Otrosí 3

Referencia:

- `docs/Sprints/referencias_otrosies/Otrosi No.3 (1).pdf`
- `docs/Sprints/referencias_otrosies/COTIZACION -LIQUIDACION (1).xlsx.pdf`

Objetivo:

- validar acumulación secuencial;
- extraer dos meses de adición (`$203.093.584` por abril y mayo, total `$406.187.168`);
- extraer impuesto de timbre como alerta informativa;
- confirmar que el histórico muestra póliza base, endoso 1, endoso 2 y endoso 3.

Pruebas:

- Procesar Otrosí 3 después de endoso 2.
- Validar que la liquidación use valor acumulado esperado `$3.332.643.339`.
- Validar que la liquidación del archivo de referencia muestra prima total de garantías `$2.044.101` y RCE `$497.192`.
- Confirmar que impuesto de timbre no se suma a la prima.
- Validar liquidación de adición, prórroga o ajuste sin prima según documento.
- Generar PDF de ajuste.
- Emitir endoso 3.
- Confirmar histórico y estado vigente final.

### Otrosí 4

Referencia:

- `docs/Sprints/referencias_otrosies/OTROSI 4 (1).pdf`
- `docs/Sprints/referencias_otrosies/COTIZACION -LIQUIDACION (1).xlsx.pdf`

Objetivo:

- validar un cuarto endoso secuencial;
- extraer valor adicionado `$269.959.248`;
- extraer nueva fecha fin `02/07/2025`;
- extraer mención de cuatro operadores por grúa;
- extraer impuesto de timbre como alerta informativa.

Pruebas:

- Procesar Otrosí 4 después de endoso 3.
- Validar que la liquidación use valor acumulado esperado `$3.602.602.587`.
- Validar que la liquidación del archivo de referencia muestra prima total de garantías `$1.754.693` y RCE `$244.521`.
- Confirmar que el histórico muestra póliza base y cuatro endosos en orden.
- Confirmar que el siguiente otrosí quedaría bloqueado si el endoso 4 no está emitido o cerrado.

### Otrosí 5

No se encontró un archivo separado de Otrosí 5 ni una sección de liquidación para Otrosí 5 en `docs/Sprints/referencias_otrosies/`. Antes de implementar pruebas automáticas o manuales para Otrosí 5, se debe confirmar si falta cargar el documento o si el alcance real del set de referencia llega solo hasta Otrosí 4.

## 16. Archivos probables a tocar

Archivos o módulos probables:

- `docs/supabase-migrations/*_otrosies_endosos.sql`: migración nueva no destructiva.
- `lib/database.types.ts`: tipos de tablas nuevas o columnas agregadas.
- `lib/schemas.ts`: schema de extracción/revisión de otrosí.
- `lib/ai.ts`: prompt y extractor de delta de otrosí, sin tocar extracción base.
- `lib/processing.ts`: aislar procesamiento de otrosí en flujo específico, sin mezclar contrato base.
- `lib/amendment-quotes.ts` o `lib/endorsement-quotes.ts`: snapshots y versionamiento de ajuste.
- `lib/amendment-calculations.ts`: liquidación incremental nueva.
- `lib/amendment-pdf.ts`: PDF de cotización de ajuste reutilizando estilo de `lib/quote-pdf.ts`.
- `app/api/upload/route.ts`: asociar otrosí a contrato/póliza emitida y validar secuencia.
- `app/api/contracts/[id]/process/route.ts`: redirigir procesamiento de otrosí a flujo específico.
- `app/api/contracts/[id]/amendments/*`: rutas nuevas de listado, revisión, validación y cotización de ajuste.
- `app/api/amendment-quotes/[id]/*`: descarga, emisión y reversión de endoso.
- `components/upload-form.tsx`: selección de contrato emitido y mensajes de secuencia.
- `components/contract-detail-client.tsx`: integración mínima de histórico, no meter toda la revisión allí.
- `components/amendment-review-client.tsx`: pantalla nueva recomendada.
- `components/amendment-history.tsx`: tabla/línea de tiempo recomendada.

## 17. Archivos que se deben evitar

Evitar tocar salvo necesidad explícita:

- `lib/coverage-calculations.ts`: cálculo base probado de amparos.
- `lib/date-only.ts`: helpers date-only existentes.
- `lib/normalizers.ts`: normalización base.
- extracción base de contratos en `lib/ai.ts`.
- procesamiento base de contratos en `lib/processing.ts`, más allá de separar dispatch de otrosí.
- lógica de anticipo.
- lógica RCE/PLO base.
- PDF de cotización base en `lib/quote-pdf.ts`, salvo reutilizar patrones visuales de forma controlada.
- rutas de cotización base, salvo lectura mínima de póliza emitida.
- migraciones históricas ya creadas.

## 18. Preguntas abiertas

Preguntas reales antes de implementar:

1. ¿Falta cargar un documento de Otrosí 5? En `docs/Sprints/referencias_otrosies/` solo aparecen contrato base, Otrosí 1, 2, 3, 4 y la liquidación exportada.
2. ¿El estado vigente debe ser solo derivado desde snapshots emitidos o se requiere una tabla materializada de póliza vigente para consultas rápidas?
3. ¿AFISEC quiere permitir marcar un otrosí como `no_aplicable` con motivo obligatorio?
4. ¿La reversión de endoso debe permitirse solo para el último endoso activo?
5. ¿La cotización de ajuste debe compartir numeración con la cotización base o usar prefijo separado, por ejemplo `AJ-COT-2026-...`?
6. ¿El PDF de ajuste debe llamarse comercialmente “Cotización de ajuste” o “Cotización de endoso”?
7. ¿La fecha de inicio de vigencia del ajuste por adición debe ser siempre la fecha de firma del otrosí o puede venir de una cláusula específica?
8. ¿La prima comercial total de cada otrosí debe sumar garantías + RCE, o el PDF debe conservar bloques separados como en la liquidación de referencia?
9. ¿La prima de RCE debe mostrarse en una línea principal RCE/PLO aunque el archivo de referencia la ubique visualmente en la fila `RC Patronal`?

## 19. Referencias funcionales del muñeco actual

### 19.1 Archivos encontrados

| Archivo | Aporta |
| --- | --- |
| `docs/Sprints/referencias_otrosies/CTTO 004 DE 2004 (2).pdf` | Contrato base. El nombre del archivo dice `2004`, pero el contenido corresponde al Contrato No. 004 de 2024. |
| `docs/Sprints/referencias_otrosies/Otrosi No.1 (1).pdf` | Otrosí 1: adición de valor, prórroga por un mes, cambio de objeto de seis a cinco grúas y obligación de modificar garantías. |
| `docs/Sprints/referencias_otrosies/Otrosi No.2 (1).pdf` | Otrosí 2: documento escaneado; adición de valor, prórroga por un mes y obligación de modificar garantías. |
| `docs/Sprints/referencias_otrosies/Otrosi No.3 (1).pdf` | Otrosí 3: adición por dos meses, prórroga hasta junio de 2025, obligación de modificar garantías e impuesto de timbre como cláusula informativa. |
| `docs/Sprints/referencias_otrosies/OTROSI 4 (1).pdf` | Otrosí 4: adición por junio de 2025, prórroga hasta julio de 2025, cuatro operadores por grúa, obligación de modificar garantías e impuesto de timbre. |
| `docs/Sprints/referencias_otrosies/COTIZACION -LIQUIDACION (1).xlsx.pdf` | Liquidación de referencia exportada desde Excel. Contiene contrato base y Otrosí 1 a 4 con valores asegurados, vigencias, primas, RCE/PLO y subamparos. |

No se encontró archivo para Otrosí 5. Tampoco aparece un bloque de Otrosí 5 en la liquidación exportada.

### 19.2 Resumen del contrato base

| Campo | Valor de referencia |
| --- | --- |
| Contrato | Contrato de prestación de servicios No. 004 de 2024 |
| Contratante | Concesión Vial de los Llanos S.A.S. |
| Contratista | FERTOBRA S.A.S. |
| Objeto | Servicio de grúa en el corredor vial administrado por el contratante, inicialmente con seis grúas. |
| Valor inicial | `$2.520.269.003` incluido IVA 19% |
| Valor mensual base | `$210.022.417` incluido IVA |
| Fecha inicio | `02/02/2024` |
| Fecha fin inicial | `02/02/2025` |
| Firma contrato | `31/01/2024` |

Amparos base según contrato y liquidación:

| Amparo | Porcentaje / cuantía | Desde | Hasta en liquidación | Días | Prima neta | Prima total |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| Cumplimiento | 30% = `$756.080.701` | `02/02/2024` | `02/03/2025` | 394 | `$1.632.306` | `$1.942.444` |
| Salarios y prestaciones | 10% = `$252.026.900` | `02/02/2024` | `02/02/2028` | 1.461 | `$2.017.596` | `$2.400.939` |
| Calidad del servicio | 30% = `$756.080.701` | `02/02/2024` | `02/03/2025` | 394 | `$1.632.306` | `$1.942.444` |
| Total garantías | `$1.764.188.302` |  |  |  | `$5.282.208` | `$6.285.827` |

RCE/PLO según contrato y liquidación:

| Cobertura RCE | Porcentaje / cuantía | Desde | Hasta | Días | Prima neta | Prima total |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| PLO | `$1.000.000.000` | `02/02/2024` | `04/03/2025` | 396 |  |  |
| Contratistas y subcontratistas | 50% = `$500.000.000` | `02/02/2024` | `04/03/2025` | 396 |  |  |
| RC Patronal | 50% = `$500.000.000` | `02/02/2024` | `04/03/2025` | 396 | `$2.712.329` | `$3.227.671` |
| RC Cruzada | 50% = `$500.000.000` | `02/02/2024` | `04/03/2025` | 396 |  |  |
| Vehículos propios y no propios | 50% = `$500.000.000` | `02/02/2024` | `04/03/2025` | 396 |  |  |

Nota importante: la liquidación ubica visualmente la prima de RCE en la fila `RC Patronal`, pero la regla de Sprint 3 debe mantener una línea principal RCE/PLO calculable y subamparos informativos para no duplicar primas.

### 19.3 Resumen de Otrosí 1 a Otrosí 5

La tabla siguiente transcribe los documentos y la liquidación Excel de
referencia. Sus columnas de días y primas no reemplazan las decisiones
funcionales aprobadas posteriormente durante las pruebas. Las diferencias
conocidas se documentan en la sección 19.4.1.

| Otrosí | Archivo | Fecha firma | Fecha fin anterior | Nueva fecha fin | Valor adicionado | Valor acumulado esperado | Días liquidación | Cambio de objeto | Ajuste garantías | Timbre |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |
| 1 | `Otrosi No.1 (1).pdf` | `31/01/2025` | `02/02/2025` | `02/03/2025` | `$203.093.584` | `$2.723.362.587` | 29 | Sí: servicio pasa de seis a cinco grúas. | Sí | No menciona. |
| 2 | `Otrosi No.2 (1).pdf` | `18/03/2025` | `02/03/2025` | `02/04/2025` | `$203.093.584` | `$2.926.456.171` | 30 | No se detecta cambio adicional; conserva cinco grúas. | Sí | No visible. |
| 3 | `Otrosi No.3 (1).pdf` | `01/04/2025` | `02/04/2025` | `02/06/2025` | `$406.187.168` | `$3.332.643.339` | 60 / 61 en RCE | No se detecta cambio de objeto. | Sí | Sí, cláusula 1% si supera 6.000 UVT. |
| 4 | `OTROSI 4 (1).pdf` | `30/05/2025` | `02/06/2025` | `02/07/2025` | `$269.959.248` | `$3.602.602.587` | 30 | Agrega referencia a cuatro operadores por grúa. | Sí | Sí, cláusula 1% si supera 6.000 UVT. |
| 5 | No encontrado | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente |

### 19.4 Valores esperados de liquidación por otrosí

La liquidación de referencia separa garantías y RCE. Los totales combinados de esta tabla son suma documental para pruebas, pero debe definirse si el PDF comercial los presenta juntos o por bloques.

| Otrosí | Prima neta garantías | Prima total garantías | Prima neta RCE | Prima total RCE | Total combinado estimado |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | `$752.515` | `$895.493` | `$198.630` | `$236.370` | `$1.131.863` |
| 2 | `$809.812` | `$963.676` | `$205.479` | `$244.521` | `$1.208.197` |
| 3 | `$1.717.732` | `$2.044.101` | `$417.808` | `$497.192` | `$2.541.293` |
| 4 | `$1.474.532` | `$1.754.693` | `$205.479` | `$244.521` | `$1.999.214` |
| 5 | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente |

### 19.4.1 Regla funcional aprobada después de revisar el Excel

El Excel se conserva como referencia comercial, pero el sistema no copia
ciegamente sus encabezados ni sus conteos. La regla vigente deriva los días de
prórroga mediante diferencia date-only entre las fechas revisadas:

| Caso | Fechas revisadas | Días funcionales | Total validado en pruebas |
| --- | --- | ---: | ---: |
| Otrosí 1 | `02/02/2025` a `02/03/2025` | 28 | `$941.509` |
| Otrosí 2 | `02/03/2025` a `02/04/2025` | 31 | `$1.060.727` |

Por tanto, los valores de 29 y 30 días y los totales combinados de las tablas
19.3 y 19.4 deben leerse como transcripción del archivo de referencia, no como
asserts vigentes de la implementación.

Para Otrosí 3 quedó confirmada la regla adicional:

- valor mensual `$203.093.584` por abril y mayo;
- dos periodos;
- valor adicionado total `$406.187.168`;
- días de adición calculados por la vigencia propia de cada amparo;
- 516 días para cumplimiento y calidad;
- 1.582 días para salarios;
- RCE/PLO sin prima por adición cuando la cuantía fija no cambia.

Detalle esperado por amparo porcentual:

| Otrosí | Amparo | Valor asegurado acumulado | Valor asegurado adición | Prima por prórroga | Prima por adición | Prima neta | Prima total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | Cumplimiento | `$817.008.776` | `$60.928.075` | `$141.887` | `$129.826` | `$271.713` | `$323.339` |
| 1 | Salarios y prestaciones | `$272.336.259` | `$20.309.358` | `$165.813` | `$43.275` | `$209.089` | `$248.816` |
| 1 | Calidad del servicio | `$817.008.776` | `$60.928.075` | `$141.887` | `$129.826` | `$271.713` | `$323.339` |
| 2 | Cumplimiento | `$877.936.851` | `$60.928.075` | `$151.903` | `$144.318` | `$296.221` | `$352.503` |
| 2 | Salarios y prestaciones | `$292.645.617` | `$20.309.358` | `$169.263` | `$48.106` | `$217.369` | `$258.670` |
| 2 | Calidad del servicio | `$877.936.851` | `$60.928.075` | `$151.903` | `$144.318` | `$296.221` | `$352.503` |
| 3 | Cumplimiento | `$999.793.002` | `$121.856.150` | `$327.309` | `$312.264` | `$639.573` | `$761.092` |
| 3 | Salarios y prestaciones | `$333.264.334` | `$40.618.717` | `$334.498` | `$104.088` | `$438.586` | `$521.917` |
| 3 | Calidad del servicio | `$999.793.002` | `$121.856.150` | `$327.309` | `$312.264` | `$639.573` | `$761.092` |
| 4 | Cumplimiento | `$1.080.780.776` | `$80.987.774` | `$230.183` | `$337.559` | `$567.742` | `$675.613` |
| 4 | Salarios y prestaciones | `$360.260.259` | `$26.995.925` | `$226.529` | `$112.520` | `$339.049` | `$403.468` |
| 4 | Calidad del servicio | `$1.080.780.776` | `$80.987.774` | `$230.183` | `$337.559` | `$567.742` | `$675.613` |

### 19.5 Campos esperados que debe extraer la IA

Para estas referencias, la extracción de otrosí debe capturar como mínimo:

- número de otrosí;
- contrato afectado: Contrato No. 004 de 2024;
- contratante: Concesión Vial de los Llanos S.A.S.;
- contratista: FERTOBRA S.A.S.;
- fecha de firma;
- fecha fin anterior mencionada o derivada;
- nueva fecha fin;
- valor adicionado;
- valor acumulado calculable;
- meses o periodo de servicio afectado;
- cambio de objeto o de número de grúas/operadores cuando exista;
- obligación de modificar garantías;
- impuesto de timbre como alerta informativa cuando aparezca;
- fuente página y texto;
- confianza y alertas de lectura.

Para el Otrosí 2, la extracción debe tolerar documento escaneado. Si no hay OCR confiable, debe quedar en revisión humana y no avanzar silenciosamente.

### 19.6 Reglas de secuencia derivadas de los documentos

- Otrosí 1 parte de contrato base con fecha fin `02/02/2025`.
- Otrosí 2 parte de Otrosí 1 y su fecha fin anterior debe ser `02/03/2025`.
- Otrosí 3 parte de Otrosí 2 y su fecha fin anterior debe ser `02/04/2025`.
- Otrosí 4 parte de Otrosí 3 y su fecha fin anterior debe ser `02/06/2025`.
- No se debe permitir procesar un otrosí posterior si el anterior no fue emitido, anulado o marcado no aplicable.
- El valor acumulado debe avanzar por suma incremental, no por reinterpretación del contrato completo.

### 19.7 Dudas o inconsistencias detectadas

- El archivo del contrato se llama `CTTO 004 DE 2004 (2).pdf`, pero el contenido dice Contrato No. 004 de 2024.
- La carpeta no contiene Otrosí 5, aunque el requerimiento menciona Otrosí 1 a 5.
- La liquidación base muestra cumplimiento y calidad hasta `02/03/2025`, mientras RCE llega a `04/03/2025`; debe definirse si esto es intencional o un ajuste manual del archivo.
- En varios otrosíes, el documento contractual indica nueva fecha fin del contrato, mientras la liquidación suma días adicionales para vigencias de garantías. La implementación debe separar fecha fin contractual y fecha hasta de cada amparo.
- La liquidación coloca visualmente la prima de RCE en `RC Patronal`; la regla de producto propuesta mantiene RCE/PLO como línea principal calculable y subamparos informativos. Esta diferencia debe decidirse antes de implementar el PDF de ajuste.
- En Otrosí 3 la liquidación muestra 60 días en el encabezado, pero RCE usa 61 días. Debe tratarse como alerta de revisión y no forzarse automáticamente.
- Las tasas cambian de 0,20% en base/Otrosí 1/Otrosí 2 a 0,19% en Otrosí 3/Otrosí 4 para garantías. Debe permitirse tasa editable por amparo en revisión.
- Otrosí 3 y 4 incluyen impuesto de timbre. Debe extraerse como alerta o campo informativo, sin mezclarlo con prima.

## Decisión técnica preliminar

La opción mínima recomendada es:

1. Usar `modificaciones_contractuales` como entidad principal del otrosí revisable.
2. Crear una tabla separada `cotizaciones_ajuste` para versiones PDF y emisión de endosos.
3. Derivar el estado vigente desde snapshots: póliza base emitida + último endoso emitido.
4. No modificar directamente `contratos` ni `amparos` base al revisar un otrosí.
5. Al emitir endoso, congelar snapshot resultante y marcarlo como fuente vigente para el siguiente otrosí.

Justificación:

- Evita romper la tabla `cotizaciones` del Sprint 2, cuya restricción `(contrato_id, version)` sirve para cotización base pero no para `Otrosí 1 v1`, `Otrosí 2 v1`, etc.
- Reutiliza la infraestructura existente de `modificaciones_contractuales` sin borrar nada.
- Permite versionamiento independiente por cada otrosí.
- Reduce riesgo de mezclar la póliza base emitida con ajustes incrementales.
- Mantiene trazabilidad completa y permite anulación/reversión.

Migración mínima probable:

- No tocar migraciones históricas.
- Verificar esquema real de `modificaciones_contractuales` en Supabase.
- Agregar columnas faltantes con `bigint/int8`, no `uuid`.
- Agregar `secuencia integer`, `cotizacion_base_id bigint`, `endoso_anterior_id bigint`, `estado`, `liquidacion jsonb`, `snapshot_vigente_anterior jsonb`, `snapshot_vigente_resultante jsonb`, `motivo_anulacion`, `fecha_anulacion`.
- Crear `cotizaciones_ajuste` con `id bigserial`, `contrato_id bigint`, `modificacion_id bigint`, `numero_cotizacion`, `version`, `estado`, `snapshot jsonb`, totales, PDF, fechas de generación/emisión/reversión y motivo.
- Crear `unique (modificacion_id, version)`.
- Crear índice único parcial para impedir más de una cotización de ajuste emitida activa por otrosí.
- Crear índice parcial para impedir más de un otrosí no terminal por contrato.

No se debe regenerar ni cambiar tipos hasta ejecutar o confirmar la migración real.

## 20. Estado de implementación funcional

Esta sección deja actualizado el documento después de la implementación funcional del Sprint 3 y los ajustes puntuales posteriores revisados en pruebas.

### 20.1 Alcance implementado

Quedó implementado el flujo operativo de otrosíes sobre póliza base emitida:

1. Carga de otrosí desde el formulario de carga, seleccionando cliente y contrato con póliza emitida.
2. Bloqueo backend si el contrato no tiene póliza base emitida activa.
3. Bloqueo de secuencia si ya existe un otrosí no emitido/no cerrado para el contrato.
4. Extracción de delta del otrosí con IA, separada del procesamiento de contrato base.
5. Revisión editable del otrosí con fechas, valores, días, tipo, objeto, alertas y observaciones.
6. Liquidación incremental contra el estado vigente anterior.
7. Generación de cotización de ajuste versionada por otrosí.
8. PDF comercial de cotización de ajuste sin tasa ni datos internos.
9. Emisión de otrosí desde una cotización de ajuste.
10. Reversión de emisión únicamente para el último otrosí emitido activo.
11. Histórico principal con póliza base, otrosíes emitidos y el otrosí actual en revisión.
12. Cierre operativo de otrosíes no emitidos para no contaminar el histórico.
    La acción visible se llama `Eliminar otrosí`, pero el backend conserva
    trazabilidad mediante estados `anulado` o `no_aplicable`; no realiza borrado
    físico.

### 20.2 Decisiones de producto aplicadas

- En la experiencia visible de usuario no debe aparecer la palabra `endoso`.
- Los textos visibles usan `Otrosí`, `Otrosí emitido`, `Emitir otrosí`, `Cotización de ajuste por otrosí`, `Histórico de otrosíes` y `Reversar emisión del otrosí`.
- Antes de emitir, la acción operativa es `Eliminar otrosí`, no `Anular`.
- Los registros eliminados o anulados de pruebas no aparecen en el histórico principal.
- La plataforma no bloquea por código un hipotético Otrosí 5; soporta secuencias posteriores si no existe un otrosí pendiente y hay póliza emitida.
- Si la póliza base emitida tiene RCE/PLO incompleto, se bloquea generar cotización de ajuste, generar PDF de ajuste y emitir otrosí, pero se permite guardar la revisión y recalcular internamente.
- RCE/PLO se mantiene como línea principal calculable; subamparos son informativos y no generan prima individual.
- Impuesto de timbre queda como alerta informativa y no se mezcla con prima.

### 20.3 Modelo y migraciones creadas

La migración funcional del Sprint 3 quedó en:

- `docs/supabase-migrations/20260519_otrosies_endosos.sql`

La migración mantiene el patrón real del proyecto:

- IDs principales `bigint/int8`, no `uuid`.
- `contrato_id bigint references contratos(id)`.
- `modificaciones_contractuales.id` alineado con secuencia/default.
- `modificaciones_contractuales.estado` con default funcional `cargado`.
- Tabla `cotizaciones_ajuste` para versionamiento de cotizaciones de ajuste.
- Índice único parcial para evitar más de una cotización de ajuste emitida activa por otrosí.
- Índice parcial para impedir más de un otrosí pendiente por contrato.
- Estados terminales utilizados: `anulado`, `no_aplicable` y
  `endoso_emitido`. Los textos visibles correspondientes son `Eliminado` y
  `Otrosí emitido`; `eliminado` y `otrosi_emitido` no son estados de base de
  datos.

También existe una migración posterior de renovación/prórroga de póliza base:

- `docs/supabase-migrations/20260527_contratos_renovacion.sql`

Esa migración pertenece a los ajustes posteriores al Sprint 3 y no forma parte del cálculo incremental de otrosíes.

### 20.4 Archivos implementados para Sprint 3

Archivos principales agregados:

- `lib/amendments.ts`: reglas de otrosíes, estado vigente, secuencia, revisión, liquidación incremental, cotización de ajuste y emisión.
- `lib/amendment-context.ts`: lectura y armado de contexto vigente para otrosíes.
- `lib/amendment-pdf.ts`: PDF comercial de cotización de ajuste.
- `components/amendments-panel.tsx`: UI de revisión, cotización, emisión, eliminación e histórico de otrosíes.
- `app/api/amendments/[id]/review/route.ts`: guardar revisión y recalcular.
- `app/api/amendments/[id]/quotes/route.ts`: generar cotización de ajuste.
- `app/api/amendments/[id]/close/route.ts`: eliminar/cerrar otrosí no emitido.
- `app/api/amendment-quotes/[id]/download/route.ts`: descargar PDF de ajuste.
- `app/api/amendment-quotes/[id]/emit/route.ts`: emitir otrosí.
- `app/api/amendment-quotes/[id]/revert/route.ts`: reversar emisión del otrosí.

Archivos integrados de forma controlada:

- `app/api/upload/route.ts`: alta de otrosí y validaciones de póliza emitida/secuencia.
- `app/api/contracts/[id]/process/route.ts`: despacho entre contrato base y otrosí.
- `components/upload-form.tsx`: selección de tipo de documento primero; para otrosí usa cliente y contrato emitido.
- `components/contract-detail-client.tsx`: integración visual del panel de cotizaciones/otrosíes sin formularios anidados.
- `lib/ai.ts`, `lib/processing.ts`, `lib/schemas.ts`: soporte específico de extracción delta de otrosí sin rediseñar extracción base.
- `lib/database.types.ts`: tipos actualizados para tablas/columnas usadas por Sprint 3.

### 20.5 Ajustes posteriores incluidos en el mismo paquete de cambios

Además del flujo de otrosíes, el paquete actual incluye ajustes funcionales solicitados después de Sprint 3:

- Reordenamiento del formulario de carga para seleccionar primero `Tipo de documento`.
- Actualización de ejecutivas comerciales a Carolina Barragán y Viviana Clavijo.
- Separación estructural de formularios para evitar `<form>` anidados e hidratación incorrecta en Next/React.
- Ajustes de lenguaje visible para retirar `endoso` de UI y PDF comercial.
- Guardar revisión de otrosí aunque existan alertas críticas, bloqueando solo cotización/PDF/emisión.
- Corrección de formato de prima en histórico para mostrar pesos enteros con separador de miles.
- Renovación/prórroga manual para pólizas base renovables, sin IA ni PDF de otrosí.
- Campo `Renovable automáticamente`.
- Alerta visual mínima de vencimiento para contratos renovables.
- Separación de totales en PDF de cotización base por garantías, responsabilidad civil y total general.
- Correcciones de fechas manuales, overrides por amparo, tasas y recálculo de amparos de contrato base.

### 20.6 Validaciones ejecutadas

Validaciones ejecutadas durante los ajustes finales:

- `npm run lint`: pasa.
- `npm test`: pasa.
- `npm run build`: pasa. El primer intento en sandbox falló por restricción de Turbopack al enlazar puerto; se repitió fuera del sandbox y compiló correctamente.

### 20.7 Riesgos pendientes

- La base de datos local/remota debe tener aplicadas las migraciones nuevas antes de probar el flujo completo.
- Las referencias funcionales de Otrosí 1 a 4 deben probarse desde datos limpios.
  Cuando el Excel difiera de la regla date-only aprobada, debe conservarse la
  diferencia documentada en 19.4.1 y no forzar el cálculo para igualar el Excel.
- Si una póliza base emitida conserva snapshots incompletos de RCE/PLO, el sistema bloqueará el avance de cotización de ajuste hasta corregir la base emitida.
- Algunas rutas y helpers usan nombres internos en inglés por estabilidad técnica (`amendment`), aunque la UI visible debe conservar lenguaje AFISEC de `otrosí`.

## 21. Fuente de verdad y cierre del Sprint

Para mantenimiento, el orden de autoridad es:

1. reglas de negocio aprobadas durante las pruebas;
2. snapshots emitidos y restricciones de base de datos;
3. funciones determinísticas y sus pruebas;
4. documentos contractuales;
5. Excel como referencia comparativa, no como motor de cálculo.

El Sprint 3 se considera funcionalmente implementado para:

- póliza base emitida como requisito;
- un solo otrosí no terminal por contrato;
- secuencias posteriores a Otrosí 4;
- revisión editable aunque existan alertas críticas;
- bloqueo de cotización y emisión cuando la base está incompleta;
- liquidación de solo prórroga, solo adición y adición más prórroga;
- cotizaciones de ajuste versionadas;
- una sola versión emitida por otrosí;
- histórico operativo;
- reversión exclusiva del último otrosí activo.

Pendientes que no deben confundirse con defectos del Sprint:

- no existe documento de referencia para Otrosí 5;
- no hay autenticación;
- no hay integración con aseguradoras;
- no hay cúmulo, cupos, reportes ni filtros avanzados;
- no hay pruebas automatizadas de navegador o integración con Supabase.
