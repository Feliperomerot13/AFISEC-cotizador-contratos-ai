# Historial de versiones

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
