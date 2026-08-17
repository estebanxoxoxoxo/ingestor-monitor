/**
 * Constantes de la aplicación.
 *
 * Regla: lo que no es secreto ni depende de la máquina vive acá.
 * Credenciales y el bucket viven en .env.
 *
 * NADA LOCAL: la app no guarda data en disco. Lo persistente vive en
 * Firebase (índice del bucket y settings en Firestore, sesiones vivas en la
 * RTDB); al bucket sólo va el viewer (un archivo por click, volátil).
 */

/** Preferencias de la app, compartidas entre máquinas. */
export const SETTINGS_DOC = {
  collection: 'settings',
  docId: 'data-analizer',
} as const

/**
 * Raíz del índice del bucket en Firestore, como relación de colecciones:
 * inventory/{capa}/days/{día} (marcador) /files/{nombre} (peso y fecha).
 * Lo alimenta la función de las notificaciones del lake; sólo hechos — los
 * totales se agregan al leer.
 *
 * ESTOS NOMBRES SON CONTRATO con el repo `ingestor-infra`, que es quien
 * escribe estos documentos. La declaración vive allá (`CONTRATO.md`); acá
 * hay una copia que ningún compilador verifica. Cambiar uno obliga a
 * cambiarlo en los dos lados.
 */
export const INVENTORY_COLLECTION = 'inventory'

/**
 * Las órdenes de regeneración del árbol: un documento por capa, que es a la
 * vez el pedido y el estado. La app lo escribe, la Cloud Function lo levanta
 * y hace el trabajo del lado de Google, contando su progreso ahí mismo.
 */
export const REGENERATE_TREE_COLLECTION = 'regenerateTree'

/**
 * Dónde empieza el lake (`{ startDay: 'YYYY-MM-DD' }`): los días anteriores
 * no se regeneran. Sin el documento, se mira toda la historia.
 */
export const LAKE_SETTINGS_DOC = {
  collection: 'settings',
  docId: 'lake',
} as const

/** Nodo de la Realtime Database con las sesiones abiertas. */
export const LIVE_SESSIONS_PATH = 'activeSessions'

/**
 * La cuenta de facturación que paga TODOS los proyectos. No es secreto:
 * identifica el informe de la consola que el botón de Config abre en el
 * navegador (embeberlo es imposible: Google prohíbe sus páginas en
 * iframes y su login no corre embebido).
 */
export const BILLING_ACCOUNT_ID = '01BF36-37A196-9E508D'
export const BILLING_REPORT_URL = `https://console.cloud.google.com/billing/${BILLING_ACCOUNT_ID}/reports`

/** Las dos capas del bucket que Ops navega y vigila. */
export type LayerId = 'raw' | 'bronze'
export const LAYERS: LayerId[] = ['raw', 'bronze']

/**
 * El minuto de la FSM del día: SOLO calendario, nada de red. Cada minuto se
 * chequea si el día UTC cambió; cuando cambia, la suscripción de hoy se muda
 * y la historia adopta el día que cerró.
 */
export const WATCH_INTERVAL_MS = 60_000

/**
 * Cuánto después de la medianoche se re-agrega UNA vez el día que cerró:
 * un flush con el reloj apenas atrasado todavía puede aterrizar ahí.
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
  treeSubscribe: 'tree:subscribe',
  treeUnsubscribe: 'tree:unsubscribe',
  treeSnapshot: 'tree:snapshot',
  layerDayFiles: 'layer:day-files',
  regenerateTreeInDb: 'tree:regenerate',
  regenerateTreeSubscribe: 'tree:regenerate-subscribe',
  regenerateTreeUnsubscribe: 'tree:regenerate-unsubscribe',
  regenerateTreeSnapshot: 'tree:regenerate-snapshot',
  sampleFile: 'sample:file',
  ingestSubscribe: 'ingest:subscribe',
  ingestUnsubscribe: 'ingest:unsubscribe',
  ingestStatus: 'ingest:status',
  firebaseUsageGet: 'firebase:usage',
  gcpUsageGet: 'gcp:usage',
  billingReportOpen: 'billing-report:open',
  firebaseConsoleOpen: 'firebase-console:open',
} as const
