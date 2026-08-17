# Glosario

Todo el vocabulario que se usa en esta carpeta, una línea cada uno. Los
marcados **(casa)** son nombres que pusimos nosotros: se pueden cambiar sin
romper nada. El resto viene de Google o de la industria y conviene
respetarlo.

## Lo que se ve en pantalla

| Término | Qué es |
| --- | --- |
| **Capa** (casa) | Cada una de las dos etapas del lake que la app navega: raw y bronze. En el código, `layer`. |
| **Raw** | La capa cruda: un archivo por tanda de requests HTTP que recibió el ingestor, tal como llegaron. |
| **Bronze** | La capa ya parseada: un archivo por tanda, con una fila por evento y columnas fijas. |
| **Árbol** (casa) | La lista de días de una capa con sus totales (archivos y peso). Es la tabla de abajo en Raw y Bronze. |
| **Log** (casa) | La tabla de arriba: los últimos diez archivos que aterrizaron HOY, con su hora y su botón Ver. |
| **Frescura** (casa) | Qué tan viejo es el último dato de una capa, en color: verde hoy, naranja 1-6 días, violeta ≥7, negra nunca. |
| **Punto** (casa) | El círculo de color al lado del nombre de cada pestaña: la frescura hecha señal testigo. |
| **Ingestado hoy** (casa) | El contador del header: archivos que entraron hoy por capa. Sale de `tree.raw.today().files`. |
| **Semáforo** (casa) | Otra cosa: si el ingestor está escuchando o no. En el código, `IngestStatus`. |
| **Viewer** (casa) | La vista previa del contenido de UN archivo, al hacerle click. |
| **Regenerate tree in DB** (casa) | El botón de Config que manda reconstruir el índice desde el bucket. El remedio, no la rutina. |
| **Orden** (casa) | El documento que la app escribe para pedir esa regeneración, y donde la función deja su progreso. |

## El dato y dónde vive

| Término | Qué es |
| --- | --- |
| **Lake** | El bucket de Cloud Storage donde el ingestor deja todo. |
| **Índice** (casa) | La copia de la estructura del lake en Firestore: `inventory/{capa}/days/{día}/files/{nombre}`. La app lee ESTO, no el bucket. |
| **Marcador** (casa) | El documento vacío de un día en el índice: dice "este día existe". Los totales se calculan, no se guardan. |
| **Partición** | La carpeta por día dentro del bucket: `dt=YYYY-MM-DD`. Convención Hive. |
| **Aterrizar** (casa) | Que un archivo aparezca en el bucket. Ahí empieza a existir para la app. |
| **Flush** | El volcado del ingestor: junta eventos unos minutos y escribe un archivo. |
| **Época** | Los diez dígitos con que arranca el nombre de cada archivo: los segundos desde 1970 al momento del flush. |
| **Día UTC** | El día de calendario en Greenwich. Todo se corta así — la medianoche UTC son las 21:00 en Argentina. |
| **Rollover** | El cambio de día UTC. En el código, el aviso `{from, to}` de la FSM. |
| **Ingesta** | Que entren datos: eventos del sitio llegando al ingestor y terminando en el lake. |

## Las piezas de esta carpeta

| Término | Qué es |
| --- | --- |
| **`todayFSM/`** (casa) | El source del día: sabe qué día UTC es y avisa cuando cambia. El único que mira el reloj. |
| **FSM** | *Finite State Machine*: el estado es el día y la única transición es la medianoche. |
| **`data/`** (casa) | La carpeta que agrupa las tres piezas que leen el índice: todayTree, historicalTree y reconciler. |
| **`data/todayTree/`** (casa) | El árbol de hoy, por suscripción. Cliente `todayTree.raw.today()`. |
| **`data/historicalTree/`** (casa) | El árbol desde ayer inclusive, por GET. Cliente `historicalTree.raw.days()`. |
| **`data/reconciler/`** (casa) | El que mergea las dos realidades y exporta el cliente `tree`. |
| **Cliente `tree`** (casa) | `tree.bronze.days()`: la única puerta a qué hay en el lake, ya mergeado. No dispara consultas. |
| **`viewer/`** (casa) | Abrir y mostrar el contenido de un archivo. DuckDB lee el temporal y se borra. |
| **`config/regenerateTree`** (casa) | Fuera de esta carpeta: deja la orden de regenerar el índice y escucha el progreso. Vive en Config, que es donde está su botón. |
| **Fachada** | `index.ts`: el único archivo que el resto de la app importa de acá. |
| **IPC** | El puente entre el proceso con credenciales y la ventana que dibuja. Todo pasa por ahí. |
| **index-writer** (casa) | La Cloud Function que anota en el índice cada archivo que aterriza. Corre en Google, con la app cerrada. |
| **regenerate-tree** (casa) | La otra Cloud Function: reconstruye el índice comparando bucket contra índice. |
| **`startDay`** (casa) | El día en que empieza el lake (`settings/lake`). La regeneración no mira más atrás. |
| **DuckDB** | La base que lee parquet y JSON comprimido sin importarlos. La usa el viewer, de a un archivo. |

## Cómo se pide el dato (y qué cuesta)

| Término | Qué es |
| --- | --- |
| **GET** | Pedir algo una vez y recibir la respuesta. Lo de `historicalTree/`. |
| **Suscripción** | Dejar una consulta abierta: Firestore empuja cada cambio. Lo de `todayTree/`. |
| **Snapshot** / **foto** | El estado de algo en un instante. `TreeSnapshot` es el único que viaja a la UI. |
| **Agregación** | Consulta que devuelve NÚMEROS del servidor (contar, sumar) en vez de documentos. Un día con 3 archivos y uno con 900 cuestan lo mismo. |
| **Lectura** | La unidad con que Firestore cobra: una por documento devuelto, o una por cada mil entradas de índice en una agregación. |
| **Merge** / **reconciliar** | Poner de acuerdo hoy y la historia. La regla: cada día pertenece a UNA fuente. |
| **Diff** | La diferencia entre bucket e índice. En la regeneración, lo único que se escribe. |
| **Gracia** (casa) | El re-chequeo único, minutos después de la medianoche, del día que cerró — por si aterrizó un flush tardío. |
| **Cache de sesión** (casa) | Lo que la app recuerda hasta que la cerrás: los días que abriste, para no volver a pagarlos. |

## Los objetos que viajan

| Término | Qué es |
| --- | --- |
| **`LayerDay`** (casa) | Un día de una capa: fecha, cantidad de archivos y peso sumado. |
| **`LayerTree`** (casa) | Todo lo que la UI necesita de una capa: hoy, días, totales, frescura, log. |
| **`TreeSnapshot`** (casa) | Las dos capas juntas: lo único que main empuja a la ventana. |
| **`TodayLogEntry`** (casa) | Un renglón del log: archivo, día, peso y aterrizaje. |
| **`DayFiles`** (casa) | La tabla de archivos de un día. |
| **`FileSample`** (casa) | Las filas y columnas que el viewer sacó de un archivo. |
| **Parquet** | El formato columnar de bronze: comprimido, con tipos y esquema adentro. |
| **NDJSON** | El formato de raw: un JSON por línea, comprimido con gzip. |
