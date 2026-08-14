import { LATEST_LOG_LIMIT, LAYERS, ROLLOVER_GRACE_MS, WATCH_INTERVAL_MS } from '@shared/config'
import type { LayerId } from '@shared/config'
import { todayUtc } from '@shared/date'
import type { IsoDate } from '@shared/date'
import type {
  FreshnessSnapshot,
  LayerState,
  PipelineLogEntry,
  StatusSnapshot,
} from '@shared/types'
import { loadEnv } from '../env'
import type { AppEnv } from '../env'
import { dayPrefix, layerPrefix, listPrefix } from '../lake'
import type { RemoteObject } from '../lake'
import { classify } from './layerFreshness'
import {
  aggregateDay,
  applyDayWrites,
  newestDayFiles,
  readDayFiles,
  readDayList,
  subscribeDayFiles,
} from './firestoreIndex'
import type { DayTotals, DayWrite, StoredFile } from './firestoreIndex'
import {
  baseName,
  daySummaryOf,
  diffByName,
  groupByDate,
  inRolloverGrace,
  instantOf,
  previousDay,
} from './indexMath'

export type StatusListener = (snapshot: StatusSnapshot) => void
export type FreshnessListener = (snapshot: FreshnessSnapshot) => void

/**
 * EL vigía — UNA sola fuente: la app lee SIEMPRE Firebase.
 *
 * El índice del bucket vive en Firestore (relación de colecciones, sólo
 * hechos) y lo alimenta EXCLUSIVAMENTE la Lambda de las notificaciones de
 * S3 (carpeta infra/), con la app cerrada inclusive. Acá sólo se consume:
 *
 *  - Al abrir: marcadores de días + totales por AGREGACIÓN del servidor
 *    (viajan números, no docs) y una suscripción en vivo a los archivos de
 *    HOY — cada doc que la Lambda anota llega pusheado en segundos.
 *  - Por minuto: nada de red — sólo el cambio de día UTC (mudar la
 *    suscripción) y, en la gracia post-medianoche, re-agregar AYER en
 *    Firestore (los flushes tardíos de Vector que la Lambda ya anotó).
 *  - Full sync (botón): la ÚNICA excepción que toca S3 — un escaneo manual
 *    que REPARA Firebase (pisa el árbol por diff, sin borrar nada nacido
 *    después del inicio del escaneo). La vista igual sale de Firebase.
 *
 * La data de los objetos tampoco se toca acá: eso es del viewer, de a un
 * archivo. Sin la Lambda instalada el índice no crece solo — Full sync es
 * el remedio.
 */

interface LayerIndex {
  /** Totales por día: agregaciones al abrir + hoy en vivo + full sync. */
  days: Map<IsoDate, DayTotals>
  /** Objetos de `dt=hoy` según FIRESTORE: la foto viva de la suscripción. */
  today: RemoteObject[]
  todayDate: IsoDate | null
  /** Los últimos archivos de días ANTERIORES a hoy (≤ LATEST_LOG_LIMIT). */
  latest: RemoteObject[]
  /** Días viejos ya leídos en esta sesión. */
  dayCache: Map<IsoDate, RemoteObject[]>
  /** Instante del archivo más nuevo conocido de la capa, ISO en UTC. */
  newestAt: string | null
  listedAt: string | null
  unsubscribeToday: (() => void) | null
  error?: string
}

const emptyIndex = (): LayerIndex => ({
  days: new Map(),
  today: [],
  todayDate: null,
  latest: [],
  dayCache: new Map(),
  newestAt: null,
  listedAt: null,
  unsubscribeToday: null,
})

const index: Record<LayerId, LayerIndex> = { raw: emptyIndex(), bronze: emptyIndex() }

const statusListeners = new Set<StatusListener>()
const freshnessListeners = new Set<FreshnessListener>()
let timer: NodeJS.Timeout | null = null
let bootPromise: Promise<void> | null = null
let booted = false
let lastStatusJson = ''
let lastFreshnessJson = ''

export function subscribeStatus(listener: StatusListener): () => void {
  statusListeners.add(listener)
  listener(statusSnapshot())
  return () => {
    statusListeners.delete(listener)
  }
}

export function subscribeFreshness(listener: FreshnessListener): () => void {
  freshnessListeners.add(listener)
  listener(freshnessSnapshot())
  return () => {
    freshnessListeners.delete(listener)
  }
}

/** Arranca el vigía. Idempotente. */
export function startInventory(): void {
  if (timer) return
  bootPromise = (async () => {
    for (const id of LAYERS) await loadIndex(id)
    booted = true
    emit()
  })()
  timer = setInterval(() => {
    if (!booted) return
    void (async () => {
      for (const id of LAYERS) await tick(id)
      emit()
    })()
  }, WATCH_INTERVAL_MS)
}

async function ensureBooted(): Promise<void> {
  if (bootPromise) await bootPromise
}

/** El índice de una capa, de la foto en memoria (alimentada por Firebase). */
export function getLayerState(layer: LayerId): LayerState {
  return toLayerState(layer)
}

/**
 * Full sync (botón): la única operación que toca S3 — escaneo COMPLETO del
 * bucket para REPARAR el índice de Firebase cuando se perdió la confianza.
 */
export async function relistLayer(layer: LayerId): Promise<LayerState> {
  await ensureBooted()
  await fullReconcile(layer)
  emit()
  return toLayerState(layer)
}

/**
 * Los objetos de UN día, SIEMPRE según Firebase: hoy de la foto viva; un
 * día viejo, del cache de la sesión o de Firestore. Si el índice no lo
 * tiene, no está — Full sync es el remedio, no un listado escondido.
 */
export async function dayObjects(layer: LayerId, day: IsoDate): Promise<RemoteObject[]> {
  await ensureBooted()
  const st = index[layer]
  if (st.todayDate === day) return [...st.today]
  const cached = st.dayCache.get(day)
  if (cached) return [...cached]
  const env = loadEnv()
  const stored = await readDayFiles(layer, day)
  const objects = stored.map((file) => storedToObject(env, layer, day, file))
  st.dayCache.set(day, objects)
  // De paso, los totales del día quedan exactos (la lectura ya se pagó).
  if (objects.length > 0) st.days.set(day, { files: objects.length, bytes: sumBytes(objects) })
  else st.days.delete(day)
  return [...objects]
}

// ── Carga inicial: Firebase y nada más ─────────────────────────

async function loadIndex(id: LayerId): Promise<void> {
  const st = index[id]
  try {
    const dayList = await readDayList(id)
    const totals = await Promise.all(
      dayList.map(async (day) => [day, await aggregateDay(id, day)] as const),
    )
    st.days = new Map(totals.filter(([, t]) => t.files > 0))
    st.listedAt = new Date().toISOString()

    // Los últimos archivos de la historia (hoy lo trae la suscripción). De
    // acá sale también el instante más nuevo conocido de la capa.
    st.latest = await latestHistory(id, todayUtc())
    const newest = st.latest[0]
    if (newest) {
      const instant = instantOf(newest)
      st.newestAt = instant > 0 ? new Date(instant).toISOString() : null
    }
    st.error = undefined
  } catch (error) {
    st.error = messageOf(error)
  }
  subscribeToday(id)
}

/** La suscripción en vivo a los archivos de HOY (lo que la Lambda anota). */
function subscribeToday(id: LayerId): void {
  const st = index[id]
  st.unsubscribeToday?.()
  const hoy = todayUtc()
  st.todayDate = hoy
  let env: AppEnv
  try {
    env = loadEnv()
  } catch (error) {
    st.error = messageOf(error)
    return
  }
  st.unsubscribeToday = subscribeDayFiles(
    id,
    hoy,
    (files) => {
      const objects = files.map((file) => storedToObject(env, id, hoy, file))
      st.today = objects
      const summary = daySummaryOf(objects)
      if (objects.length > 0) st.days.set(hoy, { files: summary.files, bytes: summary.bytes })
      else st.days.delete(hoy)
      if (summary.newestTs && (!st.newestAt || summary.newestTs > st.newestAt)) {
        st.newestAt = summary.newestTs
      }
      st.listedAt = new Date().toISOString()
      st.error = undefined
      emit()
    },
    (error) => {
      st.error = messageOf(error)
      emit()
    },
  )
}

// ── El minuto del vigía: sólo el calendario, nada de red ───────

async function tick(id: LayerId): Promise<void> {
  const st = index[id]
  const hoy = todayUtc()
  if (st.todayDate && st.todayDate !== hoy) {
    // Medianoche UTC: lo de hoy pasa a la historia del log y la suscripción
    // se muda al día nuevo. Ayer se relee de Firestore cuando haga falta
    // (el cache no lo retiene: quedaría viejo con flushes tardíos).
    st.latest = sortNewest([...st.today, ...st.latest]).slice(0, LATEST_LOG_LIMIT)
    st.dayCache.delete(st.todayDate)
    st.today = []
    subscribeToday(id)
  }
  // En la gracia post-medianoche, AYER se refresca desde Firestore (la
  // Lambda ya anotó los flushes tardíos, la memoria no): sus totales y su
  // parte del log.
  if (inRolloverGrace(new Date(), ROLLOVER_GRACE_MS)) {
    const ayer = previousDay(hoy)
    try {
      const env = loadEnv()
      const totals = await aggregateDay(id, ayer)
      if (totals.files > 0) st.days.set(ayer, totals)
      else st.days.delete(ayer)
      st.dayCache.delete(ayer)
      const files = await newestDayFiles(id, ayer, LATEST_LOG_LIMIT)
      const objects = files.map((file) => storedToObject(env, id, ayer, file))
      st.latest = sortNewest([
        ...objects,
        ...st.latest.filter((object) => object.date !== ayer),
      ]).slice(0, LATEST_LOG_LIMIT)
    } catch (error) {
      st.error = messageOf(error)
    }
  }
}

// ── Full sync: el escaneo manual que repara Firebase ───────────

/**
 * Listado COMPLETO de S3 y reconciliación total del índice — cura
 * fantasmas (lo borrado a mano) y huecos (notificaciones perdidas, Lambda
 * caída). Regla de la carrera con la Lambda viva: NO se borra nada nacido
 * después del inicio del escaneo (el nombre trae la época; es un if).
 */
async function fullReconcile(id: LayerId): Promise<void> {
  const env = loadEnv()
  const st = index[id]
  const hoy = todayUtc()
  const scanStartMs = Date.now()
  const objects = await listPrefix(env, layerPrefix(env, id))
  const byDay = groupByDate(objects)

  let markers: IsoDate[] = []
  try {
    markers = await readDayList(id)
  } catch {
    // Sin lectura de marcadores igual se reconcilia lo que el escaneo trajo.
  }
  const markerSet = new Set(markers)

  const union = new Set<IsoDate>([...byDay.keys(), ...st.days.keys(), ...markers])
  const writes: DayWrite[] = []
  for (const day of union) {
    const fresh = byDay.get(day) ?? []
    let previous: RemoteObject[] = []
    try {
      previous = day === st.todayDate ? st.today : await storedObjectsOf(env, id, day)
    } catch {
      // Firestore ilegible: el diff va contra nada.
    }
    const { added, removed } = diffByName(previous, fresh)
    const removable = removed.filter((object) => {
      const instant = instantOf(object)
      return instant === 0 || instant < scanStartMs
    })
    const clearMarker = fresh.length === 0 && markerSet.has(day)
    if (added.length > 0 || removable.length > 0 || clearMarker) {
      writes.push(toDayWrite(day, fresh, added, removable))
    }
  }

  let wrote = true
  try {
    await applyDayWrites(id, writes)
  } catch (error) {
    wrote = false
    st.error = messageOf(error)
  }
  if (wrote) st.error = undefined

  st.days = new Map(
    [...byDay.entries()].map(([day, objs]) => {
      const summary = daySummaryOf(objs)
      return [day, { files: summary.files, bytes: summary.bytes }]
    }),
  )
  st.dayCache = new Map()
  st.today = byDay.get(hoy) ?? []
  st.todayDate = hoy
  st.latest = sortNewest(objects.filter((object) => object.date && object.date !== hoy)).slice(
    0,
    LATEST_LOG_LIMIT,
  )
  st.newestAt = newestInstantOf(objects)
  st.listedAt = new Date().toISOString()
}

// ── Puentes entre el índice y la memoria ───────────────────────

function toDayWrite(
  day: IsoDate,
  fresh: RemoteObject[],
  added: RemoteObject[],
  removed: RemoteObject[],
): DayWrite {
  return {
    day,
    upserts: added.map(toStoredFile),
    removals: removed.map((object) => baseName(object.key)),
    empty: fresh.length === 0,
  }
}

const toStoredFile = (object: RemoteObject): StoredFile => ({
  name: baseName(object.key),
  size: object.size,
  lastModified: object.lastModified,
})

function storedToObject(
  env: AppEnv,
  layer: LayerId,
  day: IsoDate,
  file: StoredFile,
): RemoteObject {
  return {
    key: `${dayPrefix(env, layer, day)}${file.name}`,
    size: file.size,
    date: day,
    lastModified: file.lastModified,
  }
}

/**
 * Los últimos archivos de los días ANTERIORES a `excludeDay`, caminando el
 * índice del día más nuevo hacia atrás: una consulta con límite por día
 * tocado — casi siempre alcanza con el primero.
 */
async function latestHistory(id: LayerId, excludeDay: IsoDate): Promise<RemoteObject[]> {
  const env = loadEnv()
  const st = index[id]
  const days = [...st.days.keys()].filter((day) => day !== excludeDay).sort().reverse()
  const out: RemoteObject[] = []
  for (const day of days) {
    if (out.length >= LATEST_LOG_LIMIT) break
    const files = await newestDayFiles(id, day, LATEST_LOG_LIMIT - out.length)
    out.push(...files.map((file) => storedToObject(env, id, day, file)))
  }
  return sortNewest(out).slice(0, LATEST_LOG_LIMIT)
}

/** El aterrizaje con el que se ordena el log: LastModified, o la época. */
const landedKey = (object: RemoteObject): string =>
  object.lastModified ??
  (instantOf(object) > 0 ? new Date(instantOf(object)).toISOString() : '')

const sortNewest = (objects: RemoteObject[]): RemoteObject[] =>
  [...objects].sort((a, b) => landedKey(b).localeCompare(landedKey(a)))

/** Lo que el índice ya sabe de un día (cache de sesión, o Firestore). */
async function storedObjectsOf(
  env: AppEnv,
  layer: LayerId,
  day: IsoDate,
): Promise<RemoteObject[]> {
  const st = index[layer]
  const cached = st.dayCache.get(day)
  if (cached) return cached
  const stored = await readDayFiles(layer, day)
  return stored.map((file) => storedToObject(env, layer, day, file))
}

const sumBytes = (objects: RemoteObject[]): number =>
  objects.reduce((sum, object) => sum + object.size, 0)

function newestInstantOf(objects: RemoteObject[]): string | null {
  let newest = 0
  for (const object of objects) {
    const instant = instantOf(object)
    if (instant > newest) newest = instant
  }
  return newest > 0 ? new Date(newest).toISOString() : null
}

// ── Derivaciones de la foto ────────────────────────────────────

function emit(): void {
  const status = statusSnapshot()
  const statusJson = JSON.stringify(status)
  if (statusJson !== lastStatusJson) {
    lastStatusJson = statusJson
    for (const listener of statusListeners) listener(status)
  }

  const freshness = freshnessSnapshot()
  const freshnessJson = JSON.stringify(freshness)
  if (freshnessJson !== lastFreshnessJson) {
    lastFreshnessJson = freshnessJson
    for (const listener of freshnessListeners) listener(freshness)
  }
}

function statusSnapshot(): StatusSnapshot {
  const hoy = todayUtc()
  const today: StatusSnapshot['today'] = { raw: null, bronze: null }
  const layerErrors: StatusSnapshot['layerErrors'] = {}

  for (const id of LAYERS) {
    const st = index[id]
    if (st.error) layerErrors[id] = st.error
    if (!st.listedAt) continue
    today[id] = st.todayDate === hoy ? st.today.length : 0
  }

  return { today, layerErrors }
}

function freshnessSnapshot(): FreshnessSnapshot {
  const snapshot = {} as FreshnessSnapshot
  for (const id of LAYERS) {
    const lastDataAt = index[id].newestAt
    snapshot[id] = { state: classify(lastDataAt), lastDataAt }
  }
  return snapshot
}

function toLayerState(id: LayerId): LayerState {
  const st = index[id]
  const days = [...st.days.entries()].sort(([a], [b]) => b.localeCompare(a))
  let files = 0
  let bytes = 0
  for (const [, totals] of days) {
    files += totals.files
    bytes += totals.bytes
  }
  // El log de la capa: hoy (vivo) + la historia, los últimos N que sean.
  const latest = sortNewest([...st.today, ...st.latest])
    .slice(0, LATEST_LOG_LIMIT)
    .map((object) => toEntry(id, object))
  return {
    layer: id,
    listedAt: st.listedAt,
    files,
    bytes,
    days: days.map(([date, totals]) => ({ date, files: totals.files, bytes: totals.bytes })),
    latest,
    error: st.error,
  }
}

function toEntry(layer: LayerId, object: RemoteObject): PipelineLogEntry {
  return {
    id: `${layer}--${object.key}`,
    layer,
    key: object.key,
    file: baseName(object.key),
    size: object.size,
    lastModified: object.lastModified,
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
