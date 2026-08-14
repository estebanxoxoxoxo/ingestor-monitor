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
  getLiveEvent(connectionId: string, eventId: string): Promise<unknown | null>

  /** El índice de la capa (días, totales), de la foto del vigía. */
  getLayerState(layer: LayerId): Promise<LayerState>
  /** Curación manual: relista TODO el bucket y reconcilia el índice. */
  relistLayer(layer: LayerId): Promise<LayerState>
  /** Los archivos de UN día, del índice (Firestore/vigía) — metadata, no data. */
  getDayFiles(layer: LayerId, day: string): Promise<DayFiles>
  /** El contenido de UN archivo, pedido a S3 al momento — volátil, nada local. */
  getFileSample(query: FileSampleQuery): Promise<FileSample>

  /** Feed del vigía (contador y log de hoy). Devuelve el des-suscriptor. */
  subscribeStatus(callback: (snapshot: StatusSnapshot) => void): () => void

  /** Semáforo del ingestor (probe TCP periódico). Devuelve el des-suscriptor. */
  subscribeIngest(callback: (status: IngestStatus) => void): () => void

  /** Frescura de cada capa contra el bucket. Devuelve el des-suscriptor. */
  subscribeFreshness(callback: (snapshot: FreshnessSnapshot) => void): () => void

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
 * Los eventos que existen. Sale del registro declarado, leído DIRECTO de S3
 * (`schemas/<v>/events_v<v>.json`); si no está publicado, se cae a lo último
 * guardado en Firestore.
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

// ── Capas: el índice del bucket ────────────────────────────────
// Nada local: el índice vive en FIRESTORE como relación de colecciones
// (días → archivos) y el vigía lo mantiene con lo que descubre en `dt=hoy`.

/** Una partición diaria de la capa en el bucket. */
export interface LayerDay {
  date: string
  files: number
  bytes: number
}

export interface LayerState {
  layer: LayerId
  /** Instante del último refresco del índice, ISO en UTC. null = cargando. */
  listedAt: string | null
  files: number
  bytes: number
  /** Particiones diarias, la más nueva primero. */
  days: LayerDay[]
  /** Los últimos archivos que aterrizaron — sin ventana: el log de la capa. */
  latest: PipelineLogEntry[]
  /** El índice no se pudo leer (Firestore) o reparar (Full sync). */
  error?: string
}

// ── El día en archivos, y el viewer de un archivo ──────────────
// El índice (días → archivos, con peso y fecha que el LIST trajo gratis)
// vive en Firestore: abrir un día lee NOMBRES, jamás data. La data se toca
// recién al abrir un archivo en el viewer — un objeto por click, volátil.

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

// ── El log de cada capa ────────────────────────────────────────
// Un renglón por archivo aterrizado; viaja en LayerState.latest (los
// últimos, sin ventana de tiempo), derivado del índice de Firebase.

export interface PipelineLogEntry {
  id: string
  layer: LayerId
  /** Key completa en el bucket. */
  key: string
  /** Último segmento de la key, para la tabla. */
  file: string
  size: number
  /** El aterrizaje real en S3, ISO en UTC. */
  lastModified: string | null
}

// ── Status: el contador de hoy ─────────────────────────────────
// El log vive en cada pestaña de capa; acá quedan el contador y los avisos.

export interface StatusSnapshot {
  /** Batches que aterrizaron HOY (UTC), por capa. null = índice sin cargar. */
  today: Record<LayerId, number | null>
  /** Qué capas no puede leer el vigía, con el motivo. */
  layerErrors: Partial<Record<LayerId, string>>
}

// ── Frescura de las capas (contra el bucket) ───────────────────

/**
 * En DÍAS UTC de calendario, nunca ventanas móviles: verde = hay data de
 * HOY · naranja = lo más nuevo es de ayer a 6 días · violeta = una semana o
 * más · rojo = la capa nunca recibió nada.
 */
export type LayerFreshnessState = 'green' | 'orange' | 'violet' | 'red'

export interface LayerFreshness {
  state: LayerFreshnessState
  /**
   * Instante del dato más nuevo de la capa en el bucket, ISO en UTC. Sale
   * del prefijo de época de los archivos que escribe Vector. null = vacía.
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
   * El lake (raw + bronze) según el ÍNDICE del vigía — la vista del lake
   * que la app reconoce. El gauge diario de GCS no publica aún en el
   * proyecto, y sería una segunda fuente.
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
