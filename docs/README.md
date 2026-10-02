# Documentación técnica — AFISEC Módulo de Cumplimiento

Esta carpeta contiene la documentación técnica mantenible de la solución **AFISEC – Módulo de Cumplimiento**.

La documentación funcional para usuarios finales se entregará por separado en formatos Word/PDF. El repositorio conserva únicamente la documentación necesaria para comprender, operar, mantener y evolucionar técnicamente la solución.

## Documentos vigentes

- [`ARCHITECTURE.md`](./ARCHITECTURE.md): arquitectura As-Built, componentes, flujos técnicos, reglas de diseño y estructura de la solución.
- [`OPERATIONS.md`](./OPERATIONS.md): despliegue, operación, continuidad, responsabilidades técnicas y dependencias de infraestructura.
- [`Sprints/`](./Sprints/): histórico de construcción y decisiones por Sprint. No representa por sí solo el estado vigente de la solución.
- [`supabase-migrations/`](./supabase-migrations/): migraciones incrementales de la base de datos.

## Fuente de verdad

Para determinar el estado actual de la solución se usa este orden de prioridad:

1. Código vigente en `main`.
2. `CHANGELOG.md` y versión de `package.json`.
3. `docs/ARCHITECTURE.md` y `docs/OPERATIONS.md`.
4. Migraciones y configuración CI/CD.
5. Documentos de Sprint como contexto histórico.

## Identificación de la solución

- **Solución:** AFISEC – Módulo de Cumplimiento
- **Desarrollado por:** Andrés Felipe Romero
- **Responsable funcional:** Equipo de Placement
- **Responsable técnico:** Andrés Felipe Romero – Líder de IA
- **Versión de referencia actual:** v0.6.2

## Alcance de esta documentación

La documentación del repositorio está orientada a continuidad técnica y mantenimiento. Los siguientes entregables se gestionan fuera del repositorio como documentación formal para la empresa:

- Documento funcional y técnico de la solución.
- Manual de usuario para el Equipo de Placement.
- Ficha ejecutiva / técnica de entrega, cuando aplique.
