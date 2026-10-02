# AFISEC – Módulo de Cumplimiento

## Gap analysis de documentación As-Built

**Versión de referencia:** v0.6.2  
**Fecha de corte:** 2026-10-01  
**Desarrollado por:** Andrés Felipe Romero  
**Responsable funcional:** Equipo de Placement  
**Responsable técnico:** Andrés Felipe Romero – Líder de IA

## 1. Objetivo

Este documento identifica la documentación existente, los vacíos y las piezas requeridas para entregar formalmente la documentación de la solución **AFISEC – Módulo de Cumplimiento**.

La documentación de `docs/Sprints` se considera historial de construcción y decisiones. La descripción As-Built debe reflejar el comportamiento vigente de la versión actual en `main`.

## 2. Fuentes existentes

Actualmente el repositorio contiene:

- `README.md`: visión funcional, stack, variables de entorno, Supabase, trazabilidad y flujos generales.
- `docs/ARCHITECTURE.md`: arquitectura técnica, principios de diseño, capas, rutas y responsabilidades.
- `CHANGELOG.md`: historial de versiones hasta v0.6.2.
- `docs/Sprints/`: documentación histórica de los Sprints 1 a 5.
- `docs/supabase-migrations/`: migraciones incrementales de base de datos.
- `.github/workflows/main_afisec-cotizador-app.yml`: pipeline vigente de build y despliegue a Azure App Service.
- `.env.example`: inventario base de variables de entorno, sin valores secretos.

## 3. Hallazgos principales

### 3.1 Documentación técnica existente pero desactualizada

`docs/ARCHITECTURE.md` todavía referencia una versión anterior de la solución y no incorpora completamente los cambios de v0.6.x, entre ellos:

- nueva UX de revisión de contratos y amparos;
- estados visuales Listo / Revisar / Validado;
- dirty state y bloqueo de generación cuando existen cambios sin validar;
- evidencia IA colapsable y confianza de solo lectura;
- agrupación visual por póliza;
- plazo contractual con cantidad + unidad (días, meses, años);
- selector de calendario;
- priorización de plazo contractual frente a periodos de pago/facturación.

### 3.2 README útil, pero no sustituye documentación formal de solución

El README contiene información técnica y operativa valiosa, pero está orientado a desarrolladores y mezcla estado funcional, configuración local, Supabase, migraciones y reglas de negocio. Debe seguir existiendo, pero no debe ser el documento principal de entrega a AFISEC.

### 3.3 Los Sprints documentan evolución, no estado actual

La carpeta `docs/Sprints` conserva decisiones y entregables de cada iteración. Debe mantenerse como evidencia histórica, pero no utilizarse como manual As-Built sin reconciliarla contra el código vigente.

### 3.4 Falta documentación específica para usuarios de negocio

No existe actualmente un manual de usuario consolidado que explique, con lenguaje operativo y capturas:

- nueva cotización sin documento;
- carga y procesamiento de contratos;
- revisión de datos extraídos por IA;
- interpretación de evidencia/confianza;
- edición y validación de amparos;
- Cumplimiento y Responsabilidad Civil;
- manejo de fechas, plazos y vigencias;
- generación/versionamiento de cotizaciones;
- emisión y reversión;
- otrosíes.

### 3.5 Falta una ficha de continuidad operativa

No existe una pieza corta que concentre:

- URL de producción;
- repositorio y rama productiva;
- Azure App Service;
- Azure OpenAI;
- Azure AI Document Intelligence;
- Supabase PostgreSQL y Storage;
- pipeline CI/CD;
- variables requeridas sin secretos;
- responsables funcional/técnico;
- propietarios actuales de los recursos;
- logs, recuperación y dependencias críticas.

### 3.6 Propiedad y dependencias operativas deben quedar explícitas

Estado actual informado:

- Repositorio GitHub: administrado por Andrés Felipe Romero.
- Servicios Azure: AFISEC.
- Supabase: AFISEC.
- Responsable funcional: Equipo de Placement.
- Responsable técnico: Andrés Felipe Romero – Líder de IA.

Esto debe documentarse como estado actual de operación y continuidad.

### 3.7 Persistencia actual vs evolución prevista

La arquitectura As-Built debe documentar **Supabase PostgreSQL + Supabase Storage** como persistencia vigente.

Existe una intención futura de migrar la persistencia hacia servicios de Azure, pero esa migración no forma parte del estado actual y debe registrarse únicamente como evolución/roadmap hasta que sea ejecutada.

## 4. Entregables recomendados

### A. Documento funcional y técnico de la solución

Documento As-Built principal para dirección, TI, auditoría y continuidad.

Contenido mínimo:

1. Información general de la solución.
2. Objetivo y necesidad de negocio.
3. Alcance funcional.
4. Usuarios y responsables.
5. Flujos funcionales.
6. Arquitectura As-Built.
7. Componentes tecnológicos.
8. Uso de IA y human-in-the-loop.
9. Reglas de negocio y cálculos.
10. Modelo de datos.
11. Integraciones.
12. Gestión documental y almacenamiento.
13. Seguridad y accesos.
14. Despliegue y versionamiento.
15. Operación y soporte.
16. Trazabilidad y auditoría.
17. Limitaciones actuales.
18. Riesgos y dependencias.
19. Roadmap.
20. Historial de versiones.

### B. Manual de usuario

Documento operativo para el Equipo de Placement, con capturas de la versión vigente.

### C. Ficha técnica y continuidad

Documento corto de referencia para soporte, transferencia y continuidad operativa.

## 5. Prioridad de actualización del repositorio

1. Actualizar `docs/ARCHITECTURE.md` al estado v0.6.2.
2. Actualizar `README.md` para eliminar referencias obsoletas y apuntar a la documentación formal.
3. Crear índice de documentación en `docs/solution/README.md`.
4. Crear documento As-Built funcional/técnico.
5. Crear manual de usuario.
6. Crear ficha de continuidad.
7. Mantener `docs/Sprints` como histórico sin reescribir su contenido original.

## 6. Información que debe validarse durante la redacción

No bloquea el inicio, pero antes de cerrar los documentos debe confirmarse:

- nombre formal de la URL/producto que verá el usuario;
- responsables operativos de Azure y Supabase dentro de AFISEC;
- procedimiento interno de soporte/escalamiento;
- política esperada de respaldo/retención;
- si AFISEC desea formalizar la transferencia del repositorio a una organización corporativa;
- alcance y fecha objetivo de la futura migración de persistencia hacia Azure.

## 7. Criterio de fuente de verdad

Para describir el estado vigente se utilizará este orden de prioridad:

1. Código en `main` de la versión vigente.
2. `CHANGELOG.md` y versión de `package.json`.
3. `README.md` y `docs/ARCHITECTURE.md`, previa reconciliación.
4. Migraciones y workflow de CI/CD.
5. Documentos de Sprints únicamente como contexto histórico.
