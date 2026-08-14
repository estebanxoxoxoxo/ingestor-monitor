import type { IsoDate } from '@shared/date'
import type { RemoteObject } from '../lake'

/**
 * La aritmética pura del índice: días, diffs y resúmenes. Sin S3 y sin
 * Firestore, para que cada borde se afirme en tests sin red.
 */

/** Último segmento de la key: el nombre del archivo. */
export function baseName(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1)
}

/**
 * Instante del archivo en milisegundos: la época del nombre con que Vector
 * lo bautiza (`1786365397-<uuid>…` = hora del flush); si el nombre no la
 * trae, su LastModified. 0 = no se puede fechar.
 */
export function instantOf(object: RemoteObject): number {
  const epoch = baseName(object.key).match(/^(\d{10})\D/)
  if (epoch) return Number(epoch[1]) * 1000
  return object.lastModified ? Date.parse(object.lastModified) : 0
}

/** El día anterior a un 'YYYY-MM-DD', en UTC. */
export function previousDay(day: IsoDate): IsoDate {
  return new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
}

/** Los objetos por partición diaria. Los sin partición no entran al índice. */
export function groupByDate(objects: RemoteObject[]): Map<IsoDate, RemoteObject[]> {
  const byDay = new Map<IsoDate, RemoteObject[]>()
  for (const object of objects) {
    if (!object.date) continue
    const list = byDay.get(object.date) ?? []
    list.push(object)
    byDay.set(object.date, list)
  }
  return byDay
}

export interface DaySummary {
  files: number
  bytes: number
  /** Instante del archivo más nuevo del día, ISO en UTC. null = día vacío. */
  newestTs: string | null
}

export function daySummaryOf(objects: RemoteObject[]): DaySummary {
  let bytes = 0
  let newest = 0
  for (const object of objects) {
    bytes += object.size
    const instant = instantOf(object)
    if (instant > newest) newest = instant
  }
  return {
    files: objects.length,
    bytes,
    newestTs: newest > 0 ? new Date(newest).toISOString() : null,
  }
}

export interface ObjectsDiff {
  /** En el bucket y no en el índice (o con otro tamaño): a escribir. */
  added: RemoteObject[]
  /** En el índice y ya no en el bucket: a borrar. */
  removed: RemoteObject[]
}

/** Diff por nombre entre lo indexado y lo recién listado: SÓLO esto se escribe. */
export function diffByName(previous: RemoteObject[], fresh: RemoteObject[]): ObjectsDiff {
  const before = new Map(previous.map((o) => [baseName(o.key), o]))
  const now = new Set(fresh.map((o) => baseName(o.key)))
  const added = fresh.filter((o) => {
    const known = before.get(baseName(o.key))
    return !known || known.size !== o.size
  })
  const removed = previous.filter((o) => !now.has(baseName(o.key)))
  return { added, removed }
}

/**
 * La gracia post-medianoche: en los primeros minutos del día UTC, Vector
 * todavía puede volcar flushes en la partición de AYER (eventos de 23:5x),
 * así que el vigía también reconcilia ese día.
 */
export function inRolloverGrace(now: Date, graceMs: number): boolean {
  const sinceMidnight =
    now.getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return sinceMidnight < graceMs
}
