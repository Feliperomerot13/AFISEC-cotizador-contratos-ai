# Historial de versiones

## [0.6.0] - 2026-10-01

### Cambiado

- Revisión de contrato (`/contratos/[id]?tab=contrato`) simplificada:
  - encabezado compacto con origen, comercial, documento y fecha de carga; se
    elimina el panel lateral "Documento" y "Eliminar contrato" pasa al menú "⋯";
  - formulario de datos del contrato a ancho completo, con campos secundarios
    bajo "Más detalles";
  - resumen IA colapsable (oculto en cotizaciones manuales);
  - evidencia IA como "Pág. N · Ver fuente" bajo demanda;
  - amparos agrupados por póliza con totales por póliza (sin total general),
    como tarjeta resumen con estado Listo/Revisar y editor expandible;
  - modo de valor asegurado (porcentaje, cuantía o valor manual) muestra solo el
    campo aplicable; fechas manuales y detalle/evidencia bajo demanda;
  - subamparos RCE en lista compacta;
  - confianza IA en solo lectura (punto verde, ámbar o rojo); no se muestra en
    cotizaciones manuales;
  - barra de acciones fija con "Validado por", estado de cambios y errores de
    validación junto al botón.
- "Validado por" se preselecciona con la ejecutiva del cliente.

### Agregado

- Control de cambios sin validar: "Generar cotización" se deshabilita hasta
  volver a validar y se avisa al abandonar la página con cambios pendientes.

### Corregido

- Los cambios sin validar ya no se sobrescriben al ejecutar acciones de
  cotización u otrosíes.

## [0.5.1] - 2026-10-01

### Cambiado

- PDF de cotización: los subamparos de Responsabilidad Civil ya no se presentan
  como tabla independiente; se muestran como bloque compacto con wrapping
  ("Subamparos incluidos: ...") y la nota de que no generan prima individual.
- Se agregó "Resumen de primas" antes de las observaciones comerciales, con el
  total neto, IVA y total por póliza ya calculados (sin sumar ambas pólizas).
- Etiquetas de "Información general" del PDF: "Tomador" vuelve a "Cliente" y
  "Asegurado / contratante" vuelve a "Contratante". Es un cambio de
  presentación; no afecta el modelo de datos ni las APIs.

## [0.5.0] - 2026-10-01

### Agregado

- Nueva cotización sin documento (`contratos.origen = 'manual'`).
- Periodo adicional de vigencia con cantidad y unidad (días, meses, años).
- Lectura de fechas y periodos en español (texto largo, números en palabras).
- Clasificador único de pólizas y snapshot v2 con totales por póliza.

### Corregido

- PDF: textos y cifras fuera de celdas, wrapping, totales y filas largas.
- Amparos de Cumplimiento convertidos en RCE por palabras sueltas del texto.
- Fin de mes al sumar meses en el fallback de plazos.

### Cambiado

- El PDF y la interfaz presentan una póliza por sección y eliminan el total general.
- Meses y años se calculan con aritmética de calendario.
- `/process` rechaza contratos manuales y con póliza base emitida.
- Migraciones: `20261001_sprint5_periodo_adicional.sql` y
  `20261001_sprint5_origen_cotizacion.sql`.

## [0.4.1] - 2026-07-10

### Agregado

- Resumen contextual del documento generado por IA durante el procesamiento inicial.
- Navegación por pestañas en el detalle del contrato.
- Información de contacto del comercial en nuevas cotizaciones PDF.
- Eliminación definitiva de cotizaciones no emitidas.

### Corregido

- Persistencia de fechas manuales y sus checkboxes por amparo.
- Protección de fechas manuales frente a recálculos.
- Cálculo del valor asegurado desde porcentaje sobre base.
- Separación clara entre porcentaje, cuantía fija y valor asegurado manual.
- Limpieza de motivos de revisión que ya no aplican.
- Formato monetario uniforme con símbolo, miles y dos decimales.

### Cambiado

- Reorganización del detalle en contrato/amparos, cotizaciones/póliza y otrosíes.
- Desactivación de días adicionales cuando la fecha fin manual está activa.
- Visualización de versión reducida al número `v0.4.1`.
