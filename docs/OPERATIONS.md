# Operación y continuidad — AFISEC Módulo de Cumplimiento

## 1. Identificación

- **Solución:** AFISEC – Módulo de Cumplimiento
- **Desarrollado por:** Andrés Felipe Romero
- **Responsable funcional:** Equipo de Placement
- **Responsable técnico:** Andrés Felipe Romero – Líder de IA
- **Versión de referencia:** v0.6.2

## 2. Propiedad y administración actual

Estado actual de los principales activos:

- **Repositorio GitHub:** administrado por Andrés Felipe Romero.
- **Servicios Azure:** propiedad/administración de AFISEC.
- **Supabase:** propiedad/administración de AFISEC.

La ubicación futura del repositorio dentro de una organización corporativa de AFISEC puede evaluarse como mejora de continuidad, pero no forma parte del estado As-Built actual.

## 3. Componentes operativos

### Aplicación

- Next.js sobre Node.js 22.
- Despliegue productivo en Azure App Service.
- Nombre de la aplicación de despliegue: `afisec-cotizador-app`.

### Servicios de IA

- Azure AI Document Intelligence para extracción de contenido documental.
- Azure OpenAI para extracción estructurada y apoyo de IA.

### Persistencia

- Supabase PostgreSQL para datos transaccionales.
- Supabase Storage para documentos originales y PDFs generados.

La persistencia en Supabase representa el estado vigente. Existe una intención futura de migrar la capa de persistencia hacia servicios de Azure, pero esa migración aún no ha sido ejecutada.

## 4. CI/CD

El workflow productivo se encuentra en:

`.github/workflows/main_afisec-cotizador-app.yml`

Comportamiento actual:

1. Se activa con `push` a `main` o mediante `workflow_dispatch`.
2. Ejecuta checkout.
3. Configura Node.js 22.x.
4. Ejecuta instalación de dependencias, build y pruebas.
5. Empaqueta el artefacto.
6. Despliega en Azure Web App `afisec-cotizador-app`, slot `Production`.

El acceso al despliegue utiliza un publish profile almacenado como secreto de GitHub Actions. Los valores secretos no deben documentarse ni versionarse.

## 5. Versionamiento

- La versión de aplicación se mantiene en `package.json`.
- El historial funcional se registra en `CHANGELOG.md`.
- `main` representa la rama productiva.
- Las mejoras de documentación o desarrollo pueden prepararse en ramas separadas y fusionarse posteriormente a `main`.

## 6. Variables de entorno

La lista de referencia está en `.env.example`.

Las credenciales y secretos deben existir únicamente en los entornos correspondientes y no deben incluirse en GitHub, documentos Word/PDF ni capturas de pantalla.

Entre los recursos sensibles se encuentran:

- service role de Supabase;
- claves de Azure AI Document Intelligence;
- claves de Azure OpenAI;
- publish profile de Azure App Service.

## 7. Base de datos y migraciones

Las migraciones incrementales se conservan en:

`docs/supabase-migrations/`

Deben aplicarse de forma controlada y en el orden definido por su fecha/versionamiento.

El repositorio no debe tratar los documentos de Sprint como sustituto de la estructura vigente de base de datos. Para mantenimiento técnico se deben considerar en conjunto:

- código actual;
- tipos de base de datos;
- migraciones aplicadas;
- estructura vigente del proyecto Supabase.

## 8. Storage

La solución utiliza Storage para:

- documentos contractuales originales;
- PDFs de cotizaciones base;
- PDFs de ajustes/otrosíes.

El acceso a estos archivos se realiza desde el servidor de la aplicación. No se debe exponer una credencial administrativa de Storage al navegador.

## 9. Validaciones antes de desplegar

Antes de publicar cambios funcionales se recomienda ejecutar:

```bash
npx tsc --noEmit -p .
npm test
npm run lint
npm run build
```

Un cambio no debe promoverse a `main` si estas validaciones fallan, salvo una decisión técnica explícita y documentada.

## 10. Continuidad y soporte

Ante una incidencia se recomienda revisar, en este orden:

1. estado de Azure App Service;
2. ejecución más reciente de GitHub Actions;
3. logs de aplicación en Azure;
4. disponibilidad de Supabase;
5. disponibilidad/configuración de Azure OpenAI y Document Intelligence;
6. cambios recientes en `main` y `CHANGELOG.md`;
7. migraciones recientes de base de datos.

## 11. Dependencias críticas

La solución depende de:

- disponibilidad de Azure App Service;
- conectividad con Supabase;
- Azure AI Document Intelligence;
- Azure OpenAI;
- integridad de variables de entorno y secretos;
- compatibilidad entre código y esquema vigente de base de datos.

## 12. Limitaciones operativas actuales

- No existe todavía una migración de persistencia desde Supabase hacia Azure.
- La documentación funcional para usuarios finales no se mantiene en el repositorio; se entrega en formato Word/PDF.
- La continuidad del repositorio depende actualmente de la administración realizada por Andrés Felipe Romero.

## 13. Evolución prevista

Como línea futura de arquitectura debe evaluarse la migración de la persistencia hacia Azure, incluyendo por separado:

- base de datos PostgreSQL;
- almacenamiento de archivos;
- credenciales y conectividad;
- estrategia de migración de datos;
- pruebas de compatibilidad;
- rollback y continuidad.

Hasta que esa migración ocurra, la documentación As-Built debe seguir presentando Supabase como componente vigente.
