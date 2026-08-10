/** Contrato entre el proceso main y el renderer. */

import type { LayerId } from './config'
import type { IsoDate } from './date'

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
  getLiveEvent(connectionId: string, eventId: string): Promise<unknown | null>

  /** Estado del espejo local de una capa (última sync, inventario por día). */
  getLayerState(layer: LayerId): Promise<LayerState>
  /** Sincroniza una capa del bucket al espejo local. */
  runLayerSync(layer: LayerId): Promise<SyncResult>
  /** Avance de las syncs, con la capa adentro. Devuelve el des-suscriptor. */
  onLayerSyncProgress(callback: (progress: SyncProgress) => void): () => void

  /** El contrato del envelope de bronze, para las columnas de la tabla. */
  getSchema(): Promise<SchemaInfo>
  /** Eventos de bronze (con corte por día para el drill-in del inventario). */
  getEvents(query: EventsQuery): Promise<EventsPage>
  /** Requests crudas de un día de raw: recepción, ruta, payload completo. */
  getRawEvents(query: EventsQuery): Promise<EventsPage>

  /** Semáforo del ingestor (probe TCP periódico). Devuelve el des-suscriptor. */
  subscribeIngest(callback: (status: IngestStatus) => void): () => void

  /** Frescura de cada capa contra la caché local. Devuelve el des-suscriptor. */
  subscribeFreshness(callback: (snapshot: FreshnessSnapshot) => void): () => void

  /** Feed del pipeline (suscripción a Firestore). Devuelve el des-suscriptor. */
  subscribeStatus(callback: (snapshot: StatusSnapshot) => void): () => void

  /** Facturación de la cuenta AWS. refresh=true consulta de nuevo (US$ 0,01). */
  getBilling(refresh: boolean): Promise<BillingSummary>
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
 * Los eventos que existen. Sale del archivo declarado en el registro que la
 * sync de Bronze espeja junto con la capa; si no está publicado, se cae a lo
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

// ── Sincronización por capa ────────────────────────────────────

export type SyncPhase =
  | 'idle'
  | 'reading-state'
  | 'listing'
  | 'downloading'
  | 'saving-state'
  | 'done'
  | 'error'

export interface SyncProgress {
  layer: LayerId
  phase: SyncPhase
  message: string
  filesDone: number
  filesTotal: number
  bytesDone: number
  bytesTotal: number
}

export interface SyncFailure {
  key: string
  date: IsoDate | null
  error: string
}

export interface SyncResult {
  layer: LayerId
  ok: boolean
  /** Días recorridos, ambos extremos inclusive. El último es hoy. */
  from: IsoDate | null
  to: IsoDate | null
  downloaded: number
  /** Archivos que ya estaban en el espejo con el mismo tamaño. */
  skipped: number
  /** Archivos del día en curso que se descartaron para rehacerlo. */
  discarded: number
  bytes: number
  /** Instante que quedó registrado en Firestore, ISO en UTC. */
  lastSyncAt: string | null
  failures: SyncFailure[]
  error?: string
}

/** Una partición diaria del espejo local. */
export interface LayerDay {
  date: string
  files: number
  bytes: number
}

export interface LayerState {
  layer: LayerId
  /** Instante de la última sincronización exitosa, ISO en UTC. */
  lastSyncAt: string | null
  cacheDir: string
  files: number
  bytes: number
  /** Particiones diarias del espejo, la más nueva primero. */
  days: LayerDay[]
  /** Config rota (.env incompleto, credenciales inválidas). */
  error?: string
}

// ── Bronze: esquema declarado y tabla de eventos ───────────────

export interface EventColumn {
  name: string
  /** Tipo físico declarado en el .schema. Ej: `binary`, `int64`. */
  physicalType: string
  /** Anotación lógica del .schema. Ej: `STRING`, `TIMESTAMP(MICROS,true)`. */
  logicalType: string | null
  optional: boolean
}

export interface SchemaInfo {
  /** Versiones de schema_version encontradas en la data del espejo. */
  versions: string[]
  /** Nombre del message del .schema. Ej: `analytics_event_v1`. */
  messageName: string | null
  columns: EventColumn[]
  /** Archivos .schema efectivamente leídos. */
  sources: string[]
  error?: string
}

export type SortDirection = 'desc' | 'asc'

export interface EventsQuery {
  sortColumn: string | null
  sortDirection: SortDirection
  /** Corte por partición diaria (drill-in del inventario). null = todo. */
  day: string | null
  limit: number
  offset: number
}

export interface EventsPage {
  rows: Record<string, unknown>[]
  total: number
  limit: number
  offset: number
  error?: string
}

// ── Frescura de las capas (contra la caché local) ──────────────

/**
 * En DÍAS UTC de calendario, nunca ventanas móviles: verde = hay data de
 * HOY · naranja = lo más nuevo es de ayer a 6 días · violeta = una semana o
 * más · rojo = la caché nunca recibió nada.
 */
export type LayerFreshnessState = 'green' | 'orange' | 'violet' | 'red'

export interface LayerFreshness {
  state: LayerFreshnessState
  /**
   * Instante del dato más nuevo del espejo local, ISO en UTC. Sale del
   * prefijo de época de los archivos que escribe Vector. null = espejo vacío.
   */
  lastDataAt: string | null
}

export type FreshnessSnapshot = Record<LayerId, LayerFreshness>

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

// ── Status: el log de ingestados ───────────────────────────────
// Derivado EN MEMORIA del listado del vigía (hoy + ayer, UTC), sin
// persistencia: el bucket es la única fuente de verdad y la info se rearma
// fresca en cada pasada.

export interface PipelineLogEntry {
  id: string
  layer: LayerId
  /** Key completa en el bucket. */
  key: string
  /** Último segmento de la key, para la tabla. */
  file: string
  size: number
  /** LastModified del objeto en S3 (el aterrizaje real), ISO en UTC. */
  lastModified: string | null
}

export interface StatusSnapshot {
  entries: PipelineLogEntry[]
  /**
   * Batches que aterrizaron HOY (UTC) en el bucket, por capa. Lo deduce el
   * vigía de cada listado; null = capa sin listar.
   */
  today: Record<LayerId, number | null>
  /** Qué capas no puede listar el watcher, con el motivo (típico: IAM). */
  layerErrors: Partial<Record<LayerId, string>>
}

// ── Facturación AWS ────────────────────────────────────────────

export interface BillingService {
  service: string
  amount: number
}

export interface BillingSummary {
  /** Ventana consultada: del 1° del mes (UTC) a hoy inclusive. */
  from: string
  to: string
  /** Total del período. null si la consulta falló. */
  total: number | null
  currency: string
  /** Desglose por servicio, de mayor a menor. */
  byService: BillingService[]
  /** Cuándo se consultó, ISO en UTC. La consulta cuesta US$ 0,01: se cachea. */
  fetchedAt: string | null
  error?: string
}

// ── En vivo ────────────────────────────────────────────────────
// Espejo de /activeSessions en la Realtime Database. Cada clave del nodo es
// una CONEXIÓN (una pestaña); varias conexiones con el mismo session_id son
// una sola SESIÓN. Firebase borra la entrada cuando el cliente se desconecta.

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
  /** Conexión que lo emitió: hace falta para pedir el crudo. */
  connectionId: string
  name: string
  /** originalTimestamp del evento, ISO en UTC. */
  at: string | null
  engagedTimeSec: number | null
  values: LiveEventValue[]
}

export interface LiveConnection {
  /** Clave del nodo en la RTDB. */
  id: string
  sessionId: string | null
  anonymousId: string | null
  page: string | null
  startedAt: string | null
  lastSeen: string | null
  engagedTimeSec: number
  geo: LiveGeo
  events: LiveEvent[]
}

export interface LiveSession {
  /** session_id si lo hay; si no, la clave de la conexión. */
  id: string
  /** Cómo se agruparon las conexiones. */
  groupedBy: 'session_id' | 'anonymous_id' | 'connection'
  anonymousId: string | null
  connections: LiveConnection[]
  page: string | null
  startedAt: string | null
  lastSeen: string | null
  engagedTimeSec: number
  eventCount: number
  eventsByName: Record<string, number>
  geo: LiveGeo
  /** Tiene coordenadas y por lo tanto punto en el mapa. */
  located: boolean
}

export interface LiveSnapshot {
  sessions: LiveSession[]
  connections: number
  eventTotals: { name: string; count: number }[]
  totalEvents: number
  receivedAt: string
  error?: string
}
