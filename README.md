# Ingestor Monitor

**LA aplicación** del Analizer: quién está en el sitio ahora mismo y cómo
está el ingestor. **Nada local** — la app no guarda data en disco: lo
persistente vive en Firebase, y el lake (GCS) se toca sólo para ver un
archivo o reparar el índice. La transformación (bronze → silver → gold)
vive en BigQuery.

(Los proyectos `data-analizer-app` y `data-analizer-studio` fueron los
donantes de código y quedan para retirar; la carpeta
`Desktop/data-analizer-data` ya no se usa.)

## Pestañas

**Vivo ●** — las sesiones abiertas ahora mismo (Realtime Database):
planisferio, sesiones, detalle de eventos. El punto rojo titila porque es
una transmisión. Labels y grupos salen de `schemas/event-types.json` del
lake — el catálogo que la suite publica desde sus propios enums (behavior +
business) con `npm run publish:event-types` en el repo de la landing.

**Raw** y **Bronze** — navegadores del lake, cada una con su punto de
frescura (verde = data de HOY UTC; naranja = de ayer a 6 días; violeta =
una semana o más; rojo = nunca — días de calendario, jamás ventanas
móviles). Arriba, el **log con los últimos archivos que aterrizaron** (sin
ventana de tiempo; hoy en vivo), con **Ver** que abre la vista previa del
archivo. Abajo, el árbol: días con
buscador → click en un día → sus **archivos** (nombre, peso y fecha) →
click en un nombre → el **viewer de ese archivo**, bajado de GCS al
momento a un temporal que DuckDB lee y se borra al instante — en raw una
fila por request HTTP, en bronze una por evento, con **Ver** por registro.
Cada click paga exactamente un objeto; las credenciales jamás viajan en
SQL ni en la línea de comandos. El **Full sync** (la curación manual)
vive en la pestaña Config.

**Config** — la guardia y la operación: el semáforo del ingestor (probe
TCP cada 5 min); los accesos **GC · facturación ↗** y **Firebase · uso ↗**
— el informe de la cuenta completa y el panel de uso del proyecto,
abiertos EN EL NAVEGADOR con tu sesión (la consola de Google no se puede
embeber: sus páginas rechazan iframes y su login no corre embebido); el
**Full sync** por capa — la curación manual que relista TODO el bucket y
reconcilia el índice de Firestore; el **uso de Firebase** — lecturas, escrituras y borrados de
Firestore de HOY, y bajada/conexiones/almacenado de la RTDB — y el **uso
de Google Cloud** — almacenado del lake (según el índice), operaciones
clase A/B y servido de GCS, salida de red de la VM, ejecuciones de la
función del índice, Pub/Sub y Artifact Registry, por MES calendario —
ambos vía Cloud Monitoring (gratis a este volumen; una consulta al abrir
+ botón), cada métrica con su porcentaje de la capa Always Free entre
paréntesis (amarillo si pasa de 75 %, rojo si pasa de 90 %). La app no
muestra plata: para los números facturados están los botones a la
consola. El log de ingestados vive en la pestaña de cada capa.

## El índice (Firestore) y quién lo alimenta

El índice del bucket vive en Firestore como relación de colecciones —
`inventory/{capa}/days/{día}` (marcador) `/files/{nombre}` (peso y fecha) —
y **sólo hechos**: nada derivado. Los totales por día se piden con
agregaciones del lado del servidor (viajan números, no documentos).

Lo alimenta **exclusivamente la función `index-writer`** (Cloud Functions;
carpeta `infra/`, deploy con `npm run infra:index`) desde las
notificaciones Pub/Sub del bucket: cada archivo que aterriza está en el
índice en segundos, con la app cerrada. **La app tiene UNA sola fuente:
Firebase** — se suscribe (`onSnapshot` de HOY) y lee días y archivos de
Firestore; jamás lista el bucket por su cuenta. GCS se toca en exactamente
dos lugares: el **viewer** (el contenido de un archivo, de a uno) y el
**Full sync** — el escaneo manual que REPARA el índice cuando se perdió la
confianza (fantasmas por borrados a mano, notificaciones perdidas, función
caída), pisando el árbol por diff sin borrar nada nacido después del
inicio del escaneo. Sin la función instalada el índice no crece solo: Full
sync es el remedio.

## Cómo está organizado

La lógica del proceso principal vive en `src/main`, con **una carpeta por
sección de la app** — [`live/`](src/main/live), [`ingest-monitor/`](src/main/ingest-monitor)
(las pestañas Raw y Bronze) y [`config/`](src/main/config) —, cada una con
su README de un párrafo que cuenta qué pide y en qué orden. En la raíz de
`src/main` queda sólo lo que usan varias secciones: el `.env`, la app de
Firebase, el cliente del lake, el puente IPC y el arranque de Electron.
Los componentes que dibujan viven aparte, en `src/renderer`.

## Arranque

```bash
npm install
winget install DuckDB.cli    # para las muestras
copy .env.example .env       # completar credenciales
npm run dev
```

## Tests

```bash
npm test        # parseo de la RTDB, precedencia del catálogo, frescura, clases de ops de GCS
npm run typecheck
```
