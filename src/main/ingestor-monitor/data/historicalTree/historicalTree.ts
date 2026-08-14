import { AggregateField, getFirestore } from 'firebase-admin/firestore'
import { INVENTORY_COLLECTION, LAYERS, ROLLOVER_GRACE_MS } from '@shared/config'
import type { LayerId } from '@shared/config'
import type { IsoDate } from '@shared/date'
import type { LayerDay } from '@shared/types'
import { firebaseApp } from '../../../firebase'
import { currentDay, onDayChange } from '../../todayFSM/todayFSM'

/**
 * EL ÁRBOL HISTÓRICO: desde ayer inclusive hacia atrás. Sabe qué días
 * válidos hay y, de cada uno, cantidad de archivos y peso sumado. Todo por
 * GET, nada queda escuchando — hoy es de `todayTree/`.
 *
 * Al abrir, por capa, dos pedidos: los marcadores de `inventory/{capa}/days`
 * (1 lectura por día) y una agregación count+sum por día pasado (1 lectura
 * por día: el servidor devuelve dos números, sin abrir documentos).
 *
 * Cuando la FSM avisa la medianoche, el día que cerró se suma acá con su
 * agregación (y se re-chequea una vez, minutos después, por si un flush
 * tardío aterrizó en el día cerrado).
 *
 * El cliente:
 *
 *   historicalTree.bronze.days()          // [{ date, files, bytes }] desde ayer
 *   historicalTree.raw.files('2026-08-01') // 1 lectura por archivo, con cache
 */

export interface HistoryFile {
  name: string
  size: number
  lastModified: string | null
}

export interface HistoricalTreeClient {
  /** Los días válidos con sus totales, del más nuevo al más viejo. Sin consultas. */
  days(): LayerDay[]
  /** Los archivos de UN día: del cache de la sesión, o 1 lectura por archivo. */
  files(day: IsoDate): Promise<HistoryFile[]>
  /** true = la carga inicial ya terminó. */
  loaded(): boolean
  /** null = la historia se pudo leer. */
  error(): string | null
}

interface HistoryState {
  days: Map<IsoDate, LayerDay>
  /** Días ya abiertos en esta sesión: sus archivos, para no releerlos. */
  filesCache: Map<IsoDate, HistoryFile[]>
  loaded: boolean
  error: string | null
}

const emptyState = (): HistoryState => ({
  days: new Map(),
  filesCache: new Map(),
  loaded: false,
  error: null,
})

const state: Record<LayerId, HistoryState> = { raw: emptyState(), bronze: emptyState() }

let onChange: (() => void) | null = null
let bootPromise: Promise<void> | null = null

/**
 * Carga la historia de las dos capas y queda atenta a la medianoche.
 * `notify` se llama cada vez que el árbol cambia. Idempotente.
 */
export function startHistoricalTree(notify: () => void): void {
  onChange = notify
  if (bootPromise) return
  onDayChange(({ from }) => {
    adoptClosedDay(from)
    // Re-chequeo único: un flush con el reloj apenas atrasado puede aterrizar
    // en el día cerrado minutos después de la medianoche.
    setTimeout(() => adoptClosedDay(from), ROLLOVER_GRACE_MS)
  })
  bootPromise = (async () => {
    for (const layer of LAYERS) await load(layer)
    onChange?.()
  })()
}

/** Relee la historia entera de una capa. Se usa cuando la Cloud Function
 * terminó de regenerar el índice: los días viejos no tienen suscripción,
 * así que la foto en memoria no se enteraría sola. */
export async function reloadHistoricalTree(layer: LayerId): Promise<void> {
  state[layer].filesCache = new Map()
  await load(layer)
  onChange?.()
}

function clientOf(layer: LayerId): HistoricalTreeClient {
  return {
    days(): LayerDay[] {
      return [...state[layer].days.values()].sort((a, b) => b.date.localeCompare(a.date))
    },
    async files(day: IsoDate): Promise<HistoryFile[]> {
      if (bootPromise) await bootPromise
      const st = state[layer]
      const cached = st.filesCache.get(day)
      if (cached) return [...cached]
      const files = await readDayFiles(layer, day)
      st.filesCache.set(day, files)
      // De paso, los totales del día quedan exactos: la lectura ya se pagó.
      setTotals(layer, day, {
        date: day,
        files: files.length,
        bytes: files.reduce((sum, file) => sum + file.size, 0),
      })
      return [...files]
    },
    loaded: (): boolean => state[layer].loaded,
    error: (): string | null => state[layer].error,
  }
}

export const historicalTree: Record<LayerId, HistoricalTreeClient> = {
  raw: clientOf('raw'),
  bronze: clientOf('bronze'),
}

// ── La carga: marcadores + una agregación por día ──────────────

async function load(layer: LayerId): Promise<void> {
  const st = state[layer]
  const today = currentDay()
  try {
    const markers = await daysCol(layer).get()
    const pastDays = markers.docs.map((doc) => doc.id).filter((day) => day !== today)
    const totals = await Promise.all(pastDays.map((day) => aggregateDay(layer, day)))
    st.days = new Map(totals.filter((t) => t.files > 0).map((t) => [t.date, t]))
    st.loaded = true
    st.error = null
  } catch (error) {
    st.error = error instanceof Error ? error.message : String(error)
  }
}

// ── La medianoche: sumar el día que acaba de cerrar ────────────

function adoptClosedDay(day: IsoDate): void {
  void (async () => {
    for (const layer of LAYERS) {
      try {
        setTotals(layer, day, await aggregateDay(layer, day))
        state[layer].filesCache.delete(day)
      } catch (error) {
        state[layer].error = error instanceof Error ? error.message : String(error)
      }
    }
    onChange?.()
  })()
}

/** Un día con archivos entra al árbol; uno vacío no existe. */
function setTotals(layer: LayerId, day: IsoDate, totals: LayerDay): void {
  if (totals.files > 0) state[layer].days.set(day, totals)
  else state[layer].days.delete(day)
}

// ── Firestore: el índice, sólo lo que esta pieza pide ──────────

function daysCol(layer: LayerId) {
  return getFirestore(firebaseApp()).collection(INVENTORY_COLLECTION).doc(layer).collection('days')
}

/** Totales de un día SIN leer sus documentos: los agrega el servidor. */
async function aggregateDay(layer: LayerId, day: IsoDate): Promise<LayerDay> {
  const snap = await daysCol(layer)
    .doc(day)
    .collection('files')
    .aggregate({ files: AggregateField.count(), bytes: AggregateField.sum('size') })
    .get()
  const data = snap.data()
  return {
    date: day,
    files: typeof data.files === 'number' ? data.files : 0,
    bytes: typeof data.bytes === 'number' ? data.bytes : 0,
  }
}

async function readDayFiles(layer: LayerId, day: IsoDate): Promise<HistoryFile[]> {
  const snap = await daysCol(layer).doc(day).collection('files').get()
  return snap.docs.map((doc) => {
    const data = doc.data()
    return {
      name: doc.id,
      size: typeof data.size === 'number' ? data.size : 0,
      lastModified: typeof data.lastModified === 'string' ? data.lastModified : null,
    }
  })
}
