/** Contrato entre el proceso main y el renderer. */

import type { LayerId } from './config'

/**
 * Superficie que el preload expone al renderer como `window.api`.
 * Es el contrato: si algo no está acá, el renderer no puede hacerlo.
 */
export interface RendererApi {
  /** Nombres de evento conocidos, para labels y grupos de la vista Vivo. */
  getEventCatalog(): Promise<EventCatalog>

  getSettings(): Promise<AppSettings>
  saveSettings(settings: AppSettings): Promise<SettingsResult>

  /** Sesiones abiertas ahora mismo. Devuelve la función para cortar. */
  subscribeLive(callback: (snapshot: LiveSnapshot) => void): () => void
  /**
   * El evento tal cual vino de la RTDB. Se pide al abrir el detalle en vez de
   * viajar en cada snapshot: sólo se mira uno por vez.
   */
  getLiveEvent(tabId: string, eventId: string): Promise<unknown | null>

  /** El árbol de las dos capas, mergeado (hoy vivo + historia). Devuelve el des-suscriptor. */
  subscribeTree(callback: (snapshot: TreeSnapshot) => void): () => void
  /** Los archivos de UN día, del índice — metadata, no data. */
  getDayFiles(layer: LayerId, day: string): Promise<DayFiles>
  /** El contenido de UN archivo, pedido al lake al momento — volátil, nada local. */
  getFileSample(query: FileSampleQuery): Promise<FileSample>

  /**
   * Pide regenerar el árbol de una capa en la base. La app sólo deja la
   * orden: el trabajo lo hace una Cloud Function, del lado de Google.
   */
  regenerateTreeInDb(layer: LayerId): Promise<void>

  /** El estado de esa regeneración, en vivo. Devuelve el des-suscriptor. */
  subscribeRegenerateTree(
    callback: (snapshot: RegenerateTreeSnapshot) => void,
  ): () => void

  /** Semáforo del ingestor (probe TCP periódico). Devuelve el des-suscriptor. */
  subscribeIngest(callback: (status: IngestStatus) => void): () => void

  /** Uso de Firestore y la RTDB (Cloud Monitoring). refresh=true re-consulta. */
  getFirebaseUsage(refresh: boolean): Promise<FirebaseUsage>

  /** Uso del resto de Google Cloud (GCS, VM, función, Pub/Sub). refresh=true re-consulta. */
  getGcpUsage(refresh: boolean): Promise<GcpUsage>

  /** Abre el informe de facturación de GC en el NAVEGADOR del sistema. */
  openBillingReport(): Promise<void>

  /** Abre el panel de uso de Firebase en el NAVEGADOR del sistema. */
  openFirebaseUsage(): Promise<void>
}

/** Preferencias que se guardan en Firestore, no en la máquina. */
export interface AppSettings {
  /** Eventos de la línea de relevantes, en el orden elegido. */
  relevantEvents: string[]
  error?: string
}

/**
 * Una familia de eventos. Sale del archivo declarado: la app no conoce
 * ninguna por nombre, dibuja un contenedor por cada grupo que el registro
 * publique.
 */
export interface EventGroup {
  name: string
  label: string
  /** Cuántos cuadros por fila. Lo declara el archivo; si falta, se calcula. */
  columns: number
}

/** Un evento declarado en el registro. */
export interface EventDefinition {
  /** Valor que llega en la columna `event`. */
  name: string
  /** Cómo se muestra en la UI. */
  label: string
  /** Grupo al que pertenece, o null si el archivo no lo agrupa. */
  group: string | null
  /**
   * Nombres de la convención `properties.values[]{name,value}` que este
   * evento declara emitir. Vacío si el archivo no los declara.
   */
  values: string[]
}

/**
 * Los eventos que existen. Sale del registro declarado, leído DIRECTO del
 * lake (`schemas/event-types.json`); si no está publicado, se cae a lo
 * último guardado en Firestore.
 */
export interface EventCatalog {
  events: EventDefinition[]
  /** Grupos declarados, en el orden en que vienen en el archivo. */
  groups: EventGroup[]
  /** true si viene del archivo declarado y no de los datos. */
  declared: boolean
  error?: string
}

export interface SettingsResult {
  ok: boolean
  error?: string
}

// ── El árbol: días con sus totales, mergeado ───────────────────
// Nada local: el índice vive en FIRESTORE (días → archivos). Hoy llega por
// suscripción; la historia por GET; el reconciliador los une y empuja ESTO.

/** Un día de la capa: fecha, cantidad de archivos y peso sumado. */
export interface LayerDay {
  date: string
  files: number
  bytes: number
}

/**
 * La frescura de una capa, en DÍAS UTC de calendario, nunca ventanas
 * móviles: verde = hay data de HOY · naranja = lo más nuevo es de ayer a 6
 * días · violeta = una semana o más · negra = nunca entró nada.
 */
export type Freshness = 'green' | 'orange' | 'violet' | 'black'

/** Un renglón del log: un archivo que aterrizó HOY. */
export interface TodayLogEntry {
  file: string
  day: string
  size: number
  /** El aterrizaje, ISO en UTC. */
  at: string | null
}

/** Todo lo que la UI necesita de una capa, ya mergeado. */
export interface LayerTree {
  /** Los totales de hoy — siempre, aunque vayan 0. */
  today: LayerDay
  /** Todos los días con datos, el más nuevo primero (hoy incluido si tuvo). */
  days: LayerDay[]
  /** Totales de la capa entera. */
  files: number
  bytes: number
  freshness: Freshness
  /** El log: los últimos ≤10 archivos de hoy, del más nuevo al más viejo. */
  latest: TodayLogEntry[]
  /** true = la historia ya cargó. */
  loaded: boolean
  error: string | null
}

export interface TreeSnapshot {
  raw: LayerTree
  bronze: LayerTree
}

// ── El día en archivos, y el viewer de un archivo ──────────────
// Abrir un día lee del índice NOMBRES, jamás data. La data se toca recién
// al abrir un archivo en el viewer — un objeto por click, volátil.

export interface DayFileEntry {
  name: string
  size: number
  /** Instante del archivo (época del nombre, o LastModified). ISO en UTC. */
  at: string | null
}

export interface DayFiles {
  layer: LayerId
  day: string
  /** Más nuevo primero. */
  files: DayFileEntry[]
  bytes: number
  error?: string
}

export interface FileSampleQuery {
  layer: LayerId
  /** 'YYYY-MM-DD' (UTC). */
  day: string
  /** Nombre del archivo dentro de la partición del día. */
  file: string
}

/**
 * El contenido de un archivo para el viewer. `columns` declara qué mostrar
 * y en qué orden; las filas pueden traer claves extra (p. ej. `registro` en
 * raw) que la vista usa para el popup de Ver.
 */
export interface FileSample {
  columns: string[]
  rows: Record<string, unknown>[]
  /** true = el archivo tenía más filas que el tope del viewer y se cortó. */
  truncated: boolean
  error?: string
}

// ── Ingestor: el semáforo ──────────────────────────────────────

export interface IngestStatus {
  /** unknown = todavía sin primer chequeo. */
  state: 'up' | 'down' | 'unknown'
  /** host:puerto probeado. */
  target: string
  /** Cuánto tardó en conectar el último probe exitoso. */
  latencyMs: number | null
  /** Instante del último chequeo, ISO en UTC. */
  checkedAt: string | null
  error?: string
}

// ── Regenerar el árbol en la base ──────────────────────────────

/**
 * El estado de la regeneración de una capa: el mismo documento que la app
 * escribe para pedirla y que la Cloud Function va completando mientras
 * trabaja. `idle` = nunca se pidió.
 */
export interface RegenerateTreeState {
  layer: LayerId
  state: 'idle' | 'requested' | 'running' | 'done' | 'error'
  /** Cuándo se pidió, cuándo lo tomó la función y cuándo terminó. */
  requestedAt: string | null
  startedAt: string | null
  finishedAt: string | null
  /** Días a revisar y días ya revisados: el progreso. */
  daysTotal: number
  daysDone: number
  /** De esos días, cuántos estaban mal y se repararon. */
  daysRepaired: number
  /** Documentos escritos o borrados en el índice. */
  writes: number
  error?: string
}

export type RegenerateTreeSnapshot = Record<LayerId, RegenerateTreeState>

// ── Uso de Firebase (Cloud Monitoring) ─────────────────────────

/**
 * El consumo de Firestore y de la Realtime Database, con la misma fuente
 * que el panel de la consola (Cloud Monitoring; gratis a este volumen).
 * Los contadores son de HOY (UTC); los gauges (conexiones, almacenado) son
 * el valor actual. null = la métrica no se pudo leer o no tiene datos.
 */
export interface FirebaseUsage {
  /** Ventana de los contadores: de la medianoche UTC a la consulta. */
  from: string
  to: string
  /** Firestore hoy: documentos leídos / escritos / borrados. */
  reads: number | null
  writes: number | null
  deletes: number | null
  /**
   * Firestore: bytes almacenados (documentos + índices, lo que factura como
   * "stored data"). El EGRESO de Firestore no lo publica Cloud Monitoring:
   * se mira en el panel Usage de la consola.
   */
  firestoreStorageBytes: number | null
  /** RTDB: bytes bajados en el MES (su capa gratuita es mensual). */
  rtdbDownloadedBytes: number | null
  /** RTDB: conexiones AHORA y bytes almacenados (total actual). */
  rtdbActiveConnections: number | null
  rtdbStorageBytes: number | null
  fetchedAt: string | null
  error?: string
}

// ── Uso de Google Cloud (Cloud Monitoring + el índice) ─────────

/**
 * El consumo del resto de la infraestructura de Google Cloud — GCS, la VM
 * del ingestor, la función del índice, Pub/Sub y Artifact Registry — cada
 * variable en la unidad y ventana de su capa Always Free: los contadores
 * son del MES CALENDARIO (UTC); los almacenados, el valor actual. null =
 * no se pudo leer o todavía no hay datos.
 */
export interface GcpUsage {
  /** Ventana de los contadores: del 1° del mes (UTC) a la consulta. */
  from: string
  to: string
  /**
   * El lake (raw + bronze) según el árbol mergeado — la vista del lake que
   * la app reconoce. El gauge diario de GCS no publica aún en el proyecto,
   * y sería una segunda fuente.
   */
  lakeStorageBytes: number | null
  /**
   * GCS del mes: operaciones clase A (escrituras y listados) y clase B
   * (lecturas), de todos los buckets del proyecto, errores incluidos.
   */
  gcsClassAOps: number | null
  gcsClassBOps: number | null
  /** GCS: bytes respondidos en el mes, a cualquier destino (cota superior del egreso). */
  gcsSentBytes: number | null
  /** VM: bytes salidos en el mes, a cualquier destino (cota superior del egreso). */
  vmSentBytes: number | null
  /** Función index-writer: ejecuciones del mes (una por archivo que aterriza). */
  functionInvocations: number | null
  /** Pub/Sub: bytes tasados del mes (publicación + entrega). */
  pubsubBytes: number | null
  /** Artifact Registry: las imágenes de la función, valor actual. */
  artifactStorageBytes: number | null
  fetchedAt: string | null
  error?: string
}

// ── En vivo ────────────────────────────────────────────────────
// Espejo de /activeSessions en la Realtime Database. Cada clave del nodo es
// una PESTAÑA abierta, y acá se refleja tal cual: una fila por nodo, sin
// fusionar. Firebase la borra cuando el navegador se desconecta.
//
// Las personas no son una entidad, son un NÚMERO: `people` cuenta
// `anonymous_id` distintos. Agrupar pestañas en sesiones obligaba a inventar
// una regla de fusión por cada dato (¿el mayor tiempo o la suma?, ¿qué geo
// gana?) y hacía que la lista se reordenara sola cuando el id llegaba tarde.

export interface LiveGeo {
  city: string | null
  region: string | null
  country: string | null
  lat: number | null
  lng: number | null
}

export interface LiveEventValue {
  name: string
  value: number | string
}

export interface LiveEvent {
  id: string
  /** Pestaña que lo emitió: hace falta para pedir el crudo. */
  tabId: string
  name: string
  /** originalTimestamp del evento, ISO en UTC. */
  at: string | null
  engagedTimeSec: number | null
  values: LiveEventValue[]
}

/** Una pestaña abierta: un nodo de la RTDB, sin fusionar con ningún otro. */
export interface LiveTab {
  /** Clave del nodo. Un solo significado, siempre. */
  id: string
  /** El navegador. Dos pestañas de la misma persona lo comparten. */
  anonymousId: string | null
  sessionId: string | null
  page: string | null
  startedAt: string | null
  /**
   * La pestaña está al frente. Lo escribe la suite en el instante en que
   * cambia (`visibilitychange`): es el único dato que distingue a alguien
   * mirando de una pestaña olvidada de fondo.
   */
  visible: boolean
  /** Cuándo se escribió el nodo por última vez. NO mide presencia: sin
   * latido, quien lee sin tocar nada no escribe. Presente es estar acá. */
  lastSeen: string | null
  engagedTimeSec: number
  eventCount: number
  eventsByName: Record<string, number>
  events: LiveEvent[]
  geo: LiveGeo
  /** Tiene coordenadas y por lo tanto punto en el mapa. */
  located: boolean
}

export interface LiveSnapshot {
  tabs: LiveTab[]
  /**
   * Cuántas PERSONAS: `anonymous_id` distintos. La pestaña que todavía no lo
   * tiene cuenta como una — no se puede afirmar que sea la misma que otra.
   */
  people: number
  /** Cuántas pestañas tienen la página al frente. */
  watching: number
  eventTotals: { name: string; count: number }[]
  totalEvents: number
  receivedAt: string
  error?: string
}
