import { getDatabase } from 'firebase-admin/database'
import type { Reference } from 'firebase-admin/database'
import { LIVE_SESSIONS_PATH } from '@shared/config'
import type { LiveEvent, LiveEventValue, LiveGeo, LiveSnapshot, LiveTab } from '@shared/types'
import { firebaseApp } from '../firebase'

export type LiveListener = (snapshot: LiveSnapshot) => void

/**
 * La RTDB avisa de cada cambio: con varias sesiones escribiendo eventos, eso
 * son muchos avisos por segundo. Se emite como mucho uno cada tanto, siempre
 * con el último estado.
 */
const THROTTLE_MS = 400

const listeners = new Set<LiveListener>()
let ref: Reference | null = null
let handler: ((snapshot: unknown) => void) | null = null
let pending: LiveSnapshot | null = null
let timer: NodeJS.Timeout | null = null
let latest: LiveSnapshot | null = null
/**
 * El nodo crudo de la última lectura. Se guarda para poder devolver un evento
 * completo cuando se abre su detalle, sin tener que mandarlos todos en cada
 * snapshot: se mira uno por vez y el popup congela el valor al abrirse.
 */
let latestRaw: unknown = null

/** El evento tal cual vino de la RTDB, o null si ya no está. */
export function getLiveEvent(tabId: string, eventId: string): unknown | null {
  const node = asRecord(latestRaw)
  const tab = asRecord(node[tabId])
  const events = asRecord(tab.events)
  return events[eventId] ?? null
}

/** Se suscribe al nodo. Devuelve la función para cortar. */
export function subscribeLive(listener: LiveListener): () => void {
  listeners.add(listener)
  if (latest) listener(latest)
  if (listeners.size === 1) start()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) stop()
  }
}

function start(): void {
  try {
    ref = getDatabase(firebaseApp()).ref(LIVE_SESSIONS_PATH)
  } catch (error) {
    emitNow(emptySnapshot(messageOf(error)))
    return
  }

  handler = (snapshot: unknown): void => {
    const value = (snapshot as { val(): unknown }).val()
    latestRaw = value
    schedule(buildSnapshot(value))
  }

  ref.on('value', handler as never, (error: Error) => {
    emitNow(emptySnapshot(error.message))
  })
}

function stop(): void {
  if (ref && handler) ref.off('value', handler as never)
  ref = null
  handler = null
  latest = null
  latestRaw = null
  pending = null
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

function schedule(snapshot: LiveSnapshot): void {
  pending = snapshot
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    if (pending) emitNow(pending)
    pending = null
  }, THROTTLE_MS)
}

function emitNow(snapshot: LiveSnapshot): void {
  latest = snapshot
  for (const listener of listeners) listener(snapshot)
}

// ── Normalización ──────────────────────────────────────────────

const emptySnapshot = (error?: string): LiveSnapshot => ({
  tabs: [],
  people: 0,
  watching: 0,
  eventTotals: [],
  totalEvents: 0,
  receivedAt: new Date().toISOString(),
  error,
})

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null

/** La RTDB guarda lat/lng a veces como número y a veces como string. */
const asNumber = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function parseGeo(raw: unknown): LiveGeo {
  const geo = asRecord(raw)
  return {
    city: asString(geo.city),
    region: asString(geo.region),
    country: asString(geo.country),
    lat: asNumber(geo.lat ?? geo.latitude),
    lng: asNumber(geo.lng ?? geo.longitude),
  }
}

/**
 * En el nodo conviven dos formas de entrada de `values`:
 *  - la vieja: `{ name: 'gestures', value: 123 }`
 *  - la del SDK del 2026-08-06: `{ gestures: [246, 23, 23] }` — la clave ES el
 *    nombre, una medición por entrada.
 * El lector acepta ambas. Lo no escalar (arrays como gestures) se serializa
 * para poder mostrarse, en vez de perderse en silencio.
 */
function parseValueEntry(raw: unknown): LiveEventValue[] {
  const entry = asRecord(raw)
  const declared = asString(entry.name)
  if (declared) {
    const value = displayValue(entry.value)
    return value === null ? [] : [{ name: declared, value }]
  }
  return Object.entries(entry).flatMap(([name, item]) => {
    const value = displayValue(item)
    return value === null ? [] : [{ name, value }]
  })
}

/** Escalar tal cual; array u objeto, serializado; sin valor, nada. */
function displayValue(raw: unknown): number | string | null {
  if (typeof raw === 'number' || typeof raw === 'string') return raw
  if (typeof raw === 'boolean') return String(raw)
  if (raw && typeof raw === 'object') return JSON.stringify(raw)
  return null
}

function parseEvents(tabId: string, raw: unknown): LiveEvent[] {
  return Object.entries(asRecord(raw))
    .map(([id, value]) => {
      const event = asRecord(value)
      const options = asRecord(event.options)
      const properties = asRecord(event.properties)
      const suite = asRecord(properties.suite)
      const rawValues = Array.isArray(properties.values) ? properties.values : []
      const values: LiveEventValue[] = rawValues.flatMap(parseValueEntry)

      return {
        id,
        tabId,
        name: asString(event.event) ?? '(sin nombre)',
        at: asString(options.originalTimestamp),
        engagedTimeSec: asNumber(suite.engaged_time_sec),
        values,
      }
    })
    .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
}

/** Un nodo, una pestaña. Nada se fusiona con nada. */
function parseTab(id: string, raw: unknown): LiveTab {
  const entry = asRecord(raw)
  const events = parseEvents(id, entry.events)
  const eventsByName: Record<string, number> = {}
  for (const event of events) eventsByName[event.name] = (eventsByName[event.name] ?? 0) + 1
  const geo = parseGeo(entry.geo)

  return {
    id,
    anonymousId: asString(entry.anonymous_id),
    sessionId: asString(entry.session_id),
    page: asString(entry.page),
    startedAt: asString(entry.started_at),
    // Ausente = pestaña vieja o nodo a medio escribir: se asume al frente,
    // que es como estaba antes de que el campo existiera.
    visible: entry.visible !== false,
    lastSeen: asString(entry.last_seen),
    engagedTimeSec: asNumber(entry.engaged_time_sec) ?? 0,
    eventCount: events.length,
    eventsByName,
    events,
    geo,
    located: geo.lat !== null && geo.lng !== null,
  }
}

export function buildSnapshot(value: unknown): LiveSnapshot {
  const tabs = Object.entries(asRecord(value))
    .map(([id, raw]) => parseTab(id, raw))
    .sort((a, b) => (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''))

  const totals = new Map<string, number>()
  for (const tab of tabs) {
    for (const [name, count] of Object.entries(tab.eventsByName)) {
      totals.set(name, (totals.get(name) ?? 0) + count)
    }
  }

  return {
    tabs,
    // Las personas son un número, no una entidad: la pestaña sin
    // `anonymous_id` cuenta sola, porque no se puede afirmar que sea otra.
    people: new Set(tabs.map((tab) => tab.anonymousId ?? `tab:${tab.id}`)).size,
    watching: tabs.filter((tab) => tab.visible).length,
    eventTotals: [...totals]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    totalEvents: tabs.reduce((acc, tab) => acc + tab.eventCount, 0),
    receivedAt: new Date().toISOString(),
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
