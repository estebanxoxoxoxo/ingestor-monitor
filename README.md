# Data Analizer Ops

**LA aplicación** del Analizer: quién está en el sitio ahora mismo y cómo
está el ingestor. **Nada local** — la app no guarda data en disco: S3 se
mira directo (listados por minuto + muestras volátiles en memoria) y lo
persistente vive en Firebase. La transformación (bronze → silver → gold)
vive en BigQuery.

(Los proyectos `data-analizer-app` y `data-analizer-studio` fueron los
donantes de código y quedan para retirar; la carpeta
`Desktop/data-analizer-data` ya no se usa.)

## Pestañas

**Vivo ●** — las sesiones abiertas ahora mismo (Realtime Database):
planisferio, sesiones, detalle de eventos. El punto rojo titila porque es
una transmisión. Labels y grupos salen del registro de contratos, leído
directo de S3.

**Raw** y **Bronze** — navegadores del bucket, cada una con su punto de
frescura (verde = data de HOY UTC; naranja = de ayer a 6 días; violeta =
una semana o más; rojo = nunca — días de calendario, jamás ventanas
móviles). Arriba, el **log con los últimos archivos que aterrizaron** (sin
ventana de tiempo; hoy en vivo), con **Ver** que abre la vista previa del
archivo. Abajo, el árbol: días con
buscador → click en un día → sus **archivos** (nombre, peso y fecha) →
click en un nombre → el **viewer de ese archivo**, leído de S3 al momento
vía DuckDB (httpfs) — en raw una fila por request HTTP, en bronze una por
evento, con **Ver** por registro. Cada click paga exactamente un objeto;
volátil: nada toca el disco, y las credenciales viajan por el entorno del
proceso, nunca en SQL ni en la línea de comandos. El botón **Full sync** es
la curación manual: relista TODO el bucket y reconcilia el índice.

**Status** — la guardia: el semáforo del ingestor (probe TCP cada 5 min),
la facturación AWS del mes (una consulta al abrir + botón, US$ 0,01 cada
una) y el **uso de Firebase** vía Cloud Monitoring — lecturas, escrituras y
borrados de Firestore de HOY, y bajada/conexiones/almacenamiento de la
RTDB (una consulta al abrir + botón; gratis a este volumen). El log de
ingestados vive en la pestaña de cada capa.

## El índice (Firestore) y quién lo alimenta

El índice del bucket vive en Firestore como relación de colecciones —
`inventory/{capa}/days/{día}` (marcador) `/files/{nombre}` (peso y fecha) —
y **sólo hechos**: nada derivado. Los totales por día se piden con
agregaciones del lado del servidor (viajan números, no documentos).

Lo alimenta **exclusivamente la Lambda de las notificaciones de S3**
(carpeta `infra/`, un paste de CloudShell): cada archivo que aterriza está
en el índice en segundos, con la app cerrada. **La app tiene UNA sola
fuente: Firebase** — se suscribe (`onSnapshot` de HOY) y lee días y
archivos de Firestore; jamás lista S3 por su cuenta. S3 se toca en
exactamente dos lugares: el **viewer** (el contenido de un archivo, de a
uno) y el **Full sync** — el escaneo manual que REPARA el índice cuando se
perdió la confianza (fantasmas por borrados a mano, notificaciones
perdidas, Lambda caída), pisando el árbol por diff sin borrar nada nacido
después del inicio del escaneo. Sin la Lambda instalada el índice no crece
solo: Full sync es el remedio.

## Arranque

```bash
npm install
winget install DuckDB.cli    # para las muestras
copy .env.example .env       # completar credenciales
npm run dev
```

## Tests

```bash
npm test        # parseo de la RTDB, precedencia del catálogo, frescura
npm run typecheck
```
