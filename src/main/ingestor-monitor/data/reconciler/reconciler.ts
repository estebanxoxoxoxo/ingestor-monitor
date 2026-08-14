import { LATEST_LOG_LIMIT } from '@shared/config'
import type { LayerId } from '@shared/config'
import type { IsoDate } from '@shared/date'
import type { DayFiles, Freshness, LayerDay, LayerTree, TodayLogEntry, TreeSnapshot } from '@shared/types'
import { historicalTree } from '../historicalTree/historicalTree'
import { currentDay } from '../../todayFSM/todayFSM'
import { todayTree } from '../todayTree/todayTree'

/**
 * EL RECONCILIADOR. Hay dos realidades — hoy, que llega empujada por
 * `todayTree/`, y la historia, que `historicalTree/` pidió con GETs — y todo
 * lo que dependa de la data necesita UNA. Acá se mergean y sale el cliente:
 *
 *   tree.bronze.days()       // hoy en vivo + la historia, más nuevo primero
 *   tree.raw.today()         // { date, files, bytes } — siempre, aunque 0
 *   tree.raw.freshness()     // 'green' | 'orange' | 'violet' | 'black'
 *   tree.bronze.latest()     // el log: los ≤10 de hoy
 *   tree.raw.files(day)      // los archivos de un día (hoy gratis)
 *
 * NO pide ni escucha nada (salvo `files(day)`, que es el drill bajo demanda):
 * lee las dos fotos en memoria, así que se puede llamar en cada render sin
 * costo. La regla del merge: cada día pertenece a UNA fuente — hoy es del
 * vivo, el resto de la historia. Ningún día se cuenta dos veces.
 *
 * De acá también sale el ÚNICO canal hacia la UI: `subscribeTree` empuja el
 * snapshot completo cuando de verdad cambió algo.
 */

// ── Las reglas puras (exportadas para afirmarlas en tests) ─────

/** Pega hoy (en vivo) con la historia. Si la historia trajera hoy, manda el vivo. */
export function mergeDays(history: LayerDay[], today: LayerDay): LayerDay[] {
  const past = history.filter((day) => day.date !== today.date)
  return today.files > 0 ? [today, ...past] : past
}

/**
 * La frescura, en DÍAS UTC de calendario — nunca ventanas móviles: verde =
 * hay data de HOY; naranja = lo más nuevo es de ayer a 6 días; violeta =
 * una semana o más; negra = nunca entró nada.
 */
export function freshnessOf(newestDay: IsoDate | null, today: IsoDate): Freshness {
  if (!newestDay) return 'black'
  const ageDays = Math.round((Date.parse(today) - Date.parse(newestDay)) / 86_400_000)
  if (ageDays <= 0) return 'green'
  if (ageDays < 7) return 'orange'
  return 'violet'
}

interface FileLike {
  name: string
  size: number
  lastModified: string | null
}

/**
 * Instante del archivo en milisegundos: la época con que el ingestor lo
 * bautiza (`1786365397-<uuid>…` = hora del flush); si el nombre no la trae,
 * su LastModified. 0 = no se puede fechar.
 */
export function instantOf(file: FileLike): number {
  const epoch = file.name.match(/^(\d{10})\D/)
  if (epoch) return Number(epoch[1]) * 1000
  return file.lastModified ? Date.parse(file.lastModified) : 0
}

/** Del que aterrizó último al primero. No toca el array que recibe. */
export function sortNewest<T extends FileLike>(files: T[]): T[] {
  return [...files].sort((a, b) => instantOf(b) - instantOf(a))
}

/** El aterrizaje para mostrar: LastModified, o la época del nombre. */
function landedAt(file: FileLike): string | null {
  if (file.lastModified) return file.lastModified
  const instant = instantOf(file)
  return instant > 0 ? new Date(instant).toISOString() : null
}

// ── El cliente mergeado ────────────────────────────────────────

export interface TreeClient {
  days(): LayerDay[]
  today(): LayerDay
  freshness(): Freshness
  latest(): TodayLogEntry[]
  files(day: IsoDate): Promise<DayFiles>
  loaded(): boolean
  error(): string | null
}

function clientOf(layer: LayerId): TreeClient {
  return {
    days: (): LayerDay[] => mergeDays(historicalTree[layer].days(), todayTree[layer].today()),
    today: (): LayerDay => todayTree[layer].today(),
    freshness(): Freshness {
      const days = mergeDays(historicalTree[layer].days(), todayTree[layer].today())
      return freshnessOf(days[0]?.date ?? null, currentDay())
    },
    latest(): TodayLogEntry[] {
      const today = todayTree[layer].today().date
      return sortNewest(todayTree[layer].files())
        .slice(0, LATEST_LOG_LIMIT)
        .map((file) => ({ file: file.name, day: today, size: file.size, at: landedAt(file) }))
    },
    async files(day: IsoDate): Promise<DayFiles> {
      // Hoy sale del vivo, gratis; el resto lo lee la historia (con cache).
      const files =
        day === todayTree[layer].today().date
          ? todayTree[layer].files()
          : await historicalTree[layer].files(day)
      return {
        layer,
        day,
        files: sortNewest(files).map((file) => ({
          name: file.name,
          size: file.size,
          at: landedAt(file),
        })),
        bytes: files.reduce((sum, file) => sum + file.size, 0),
      }
    },
    loaded: (): boolean => historicalTree[layer].loaded(),
    error: (): string | null => historicalTree[layer].error() ?? todayTree[layer].error(),
  }
}

export const tree: Record<LayerId, TreeClient> = {
  raw: clientOf('raw'),
  bronze: clientOf('bronze'),
}

// ── El snapshot hacia la UI ────────────────────────────────────

function layerSnapshot(layer: LayerId): LayerTree {
  const client = tree[layer]
  const days = client.days()
  let files = 0
  let bytes = 0
  for (const day of days) {
    files += day.files
    bytes += day.bytes
  }
  return {
    today: client.today(),
    days,
    files,
    bytes,
    freshness: freshnessOf(days[0]?.date ?? null, currentDay()),
    latest: client.latest(),
    loaded: client.loaded(),
    error: client.error(),
  }
}

export function treeSnapshot(): TreeSnapshot {
  return { raw: layerSnapshot('raw'), bronze: layerSnapshot('bronze') }
}

const listeners = new Set<(snapshot: TreeSnapshot) => void>()
let lastJson = ''

/** El árbol en vivo hacia la UI. Devuelve el des-suscriptor. */
export function subscribeTree(listener: (snapshot: TreeSnapshot) => void): () => void {
  listeners.add(listener)
  listener(treeSnapshot())
  return () => {
    listeners.delete(listener)
  }
}

/** Una fuente cambió: se recalcula el snapshot y se avisa sólo si difiere. */
export function notifyTreeChanged(): void {
  const snapshot = treeSnapshot()
  const json = JSON.stringify(snapshot)
  if (json === lastJson) return
  lastJson = json
  for (const listener of listeners) listener(snapshot)
}
