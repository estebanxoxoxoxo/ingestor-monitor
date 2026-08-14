# Ingestor monitor

Qué se está comiendo el lake: las capas **raw** y **bronze** — sus días, sus
archivos y el contenido de cada uno.

Cada palabra que se usa acá está definida en una línea en el
[glosario](GLOSARIO.md).

## Las piezas

Una carpeta por responsabilidad, un archivo por carpeta. Las tres que leen
el índice viven juntas en `data/`.

| Sección | Responsabilidad | Entra | Sale |
| --- | --- | --- | --- |
| `todayFSM/` | El source del día: saber qué día UTC es y avisar la medianoche. Único que mira el reloj. | El reloj. | El día de hoy y un aviso `{from, to}` al cruzar. |
| `data/todayTree/` | El árbol de HOY, en vivo. Única conexión abierta. Al cambiar el día, muda la suscripción. | Suscripción a `days/{hoy}/files`. | Cliente `todayTree`: totales y archivos de hoy. |
| `data/historicalTree/` | El árbol desde AYER inclusive: días válidos con cantidad de archivos y peso sumado. Todo por GET. Al cambiar el día, suma el que acaba de cerrar. | Marcadores + una agregación por día. | Cliente `historicalTree`: días con totales, archivos de un día. |
| `data/reconciler/` | Mergear las dos realidades en UN cliente. No pide ni escucha nada. | Las fotos de los dos árboles. | Cliente `tree` (abajo) y el único snapshot hacia la UI. |
| `viewer/` | Abrir y mostrar UN archivo. Lo único que toca data del lake. | Capa, día y nombre. | Filas y columnas para la tabla. |
| `index.ts` | Fachada: cablea las piezas y expone al IPC. Sin lógica. | — | `startIngestorMonitor` y los puentes. |

Regenerar el índice **no vive acá**: se pide desde `config/`, que es donde
está su botón, y sólo vuelve por `reloadHistoricalTree`.

## El cliente `tree`

Todo lo que dependa de la data se arma sobre esto. **No dispara consultas**
(salvo `files(day)`, el drill bajo demanda): lee las fotos en memoria, así
que se puede llamar en cada render sin costo.

```ts
tree.bronze.days()       // hoy en vivo + la historia, más nuevo primero
tree.raw.today()         // { date, files, bytes } — siempre, aunque 0
tree.raw.freshness()     // 'green' | 'orange' | 'violet' | 'black'
tree.bronze.latest()     // el log: los ≤10 archivos de hoy
tree.raw.files(day)      // los archivos de un día (hoy gratis)
```

Los indicadores lo consumen en una línea: el punto de una pestaña es
`tree.raw.freshness()` (verde hoy · naranja 1-6 días · violeta ≥7 · negra
nunca) y el contador del header es `tree.raw.today().files`.

**La regla del merge**: cada día pertenece a UNA fuente — hoy es de
`todayTree/`, el resto de `historicalTree/`. Ningún día se cuenta dos veces.

## La medianoche

`todayFSM/` avisa `{from, to}` y cada árbol reacciona solo: `todayTree/`
corta la suscripción de `from` y abre la de `to`; `historicalTree/` pide los
totales de `from` con una agregación (y los re-pide una vez, minutos
después, por si aterrizó un flush tardío).

## Las llamadas y lo que cuestan

**Al abrir, por capa**: 1 lectura por día (marcadores) + 1 por día pasado
(agregación count+sum: números del servidor, sin abrir documentos) + 1 por
archivo de hoy (la suscripción). **Después no se consulta más**: la Cloud
Function anota cada archivo y la suscripción lo empuja.

**Bajo demanda**: abrir un día viejo = 1 lectura por archivo, cacheado hasta
cerrar la app; hoy y los ya abiertos, gratis. Abrir un archivo = 1 objeto
del bucket, volátil.

**Regenerate tree in DB** (botón, el remedio): la app escribe un documento y
puede cerrarse. La función lista el bucket, compara cada día con una
agregación y sólo abre los días que no coinciden, escribiendo el diff. Al
terminar, la historia se relee.
