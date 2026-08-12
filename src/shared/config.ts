/**
 * Constantes de la aplicación.
 *
 * Regla: lo que no es secreto ni depende de la máquina vive acá.
 * Credenciales y el bucket viven en .env.
 *
 * NADA LOCAL: la app no guarda data en disco. Lo persistente vive en
 * Firebase (índice del bucket y settings en Firestore, sesiones vivas en la
 * RTDB); a S3 sólo van el vigía (LIST de hoy) y el viewer (un archivo por
 * click, volátil).
 */

/** Preferencias de la app, compartidas entre máquinas. */
export const SETTINGS_DOC = {
  collection: 'settings',
  docId: 'data-analizer',
} as const

/**
 * Raíz del índice del bucket en Firestore, como relación de colecciones:
 * inventory/{capa}/days/{día} (marcador) /files/{nombre} (peso y fecha).
 * Lo alimenta la Lambda de las notificaciones de S3 (ver infra/) y lo
 * reconcilia la app; sólo hechos — los totales se agregan al leer.
 */
export const INVENTORY_COLLECTION = 'inventory'

/** Nodo de la Realtime Database con las sesiones abiertas. */
export const LIVE_SESSIONS_PATH = 'activeSessions'

/** Las dos capas del bucket que Ops navega y vigila. */
export type LayerId = 'raw' | 'bronze'
export const LAYERS: LayerId[] = ['raw', 'bronze']

/**
 * El minuto del vigía: SOLO calendario, nada de red. La app tiene UNA
 * fuente (Firebase, por suscripción); esta pasada únicamente muda la
 * suscripción cuando cambia el día UTC y, en la gracia post-medianoche,
 * re-agrega los totales de ayer en Firestore.
 */
export const WATCH_INTERVAL_MS = 60_000

/**
 * Tras la medianoche UTC, Vector todavía puede volcar flushes en la
 * partición de AYER (eventos de 23:5x): durante esta gracia el vigía
 * también reconcilia ese día.
 */
export const ROLLOVER_GRACE_MS = 10 * 60_000

/** El log de cada capa: los últimos N archivos, sin ventana de tiempo. */
export const LATEST_LOG_LIMIT = 10

/** Tope de filas del viewer de un archivo, por si viene gigante. */
export const SAMPLE_ROW_CAP = 1_000

/**
 * El semáforo del ingestor: un probe TCP al puerto de ingest cada 5 minutos.
 * Conectar (aunque el servidor después conteste 400) prueba que la instancia
 * está levantada y escuchando — la definición pedida de "funciona".
 */
export const PING_INTERVAL_MS = 5 * 60_000
export const PING_TIMEOUT_MS = 5_000

/** Canales IPC entre el proceso main y el renderer. */
export const IPC = {
  eventsCatalog: 'events:catalog',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  liveSubscribe: 'live:subscribe',
  liveUnsubscribe: 'live:unsubscribe',
  liveSnapshot: 'live:snapshot',
  liveEvent: 'live:event',
  layerState: 'layer:state',
  layerRelist: 'layer:relist',
  layerDayFiles: 'layer:day-files',
  sampleFile: 'sample:file',
  statusSubscribe: 'status:subscribe',
  statusUnsubscribe: 'status:unsubscribe',
  statusSnapshot: 'status:snapshot',
  freshnessSubscribe: 'freshness:subscribe',
  freshnessUnsubscribe: 'freshness:unsubscribe',
  freshnessSnapshot: 'freshness:snapshot',
  ingestSubscribe: 'ingest:subscribe',
  ingestUnsubscribe: 'ingest:unsubscribe',
  ingestStatus: 'ingest:status',
  billingGet: 'billing:get',
  firebaseUsageGet: 'firebase:usage',
} as const
