import { getFirestore } from 'firebase-admin/firestore'
import { INVENTORY_COLLECTION, LAYERS } from '@shared/config'
import type { LayerId } from '@shared/config'
import type { IsoDate } from '@shared/date'
import type { LayerDay } from '@shared/types'
import { firebaseApp } from '../../../firebase'
import { currentDay, onDayChange } from '../../todayFSM/todayFSM'

/**
 * EL ÁRBOL DE HOY. La única conexión abierta de la app: una suscripción por
 * capa a `inventory/{capa}/days/{hoy}/files`, que Firestore empuja con cada
 * archivo que la función anota. Cuesta 1 lectura por archivo al abrir y 1
 * por cada uno que aterriza después.
 *
 * Cuando la FSM avisa que cambió el día, corta la suscripción vieja y abre
 * la del día nuevo, en cero. El día que cerró pasa a ser problema de
 * `historicalTree/`.
 *
 * El cliente:
 *
 *   todayTree.bronze.today()   // { date, files, bytes } — siempre, aunque 0
 *   todayTree.raw.files()      // todos los archivos de hoy, ya en memoria
 */

export interface TodayFile {
  name: string
  size: number
  lastModified: string | null
}

export interface TodayTreeClient {
  /** Los totales de hoy. Nunca dispara consultas: lee la foto en memoria. */
  today(): LayerDay
  /** Los archivos de hoy (nombre, peso, aterrizaje). Gratis: ya llegaron. */
  files(): TodayFile[]
  /** null = la suscripción está sana. */
  error(): string | null
}

interface TodayState {
  day: IsoDate
  files: TodayFile[]
  unsubscribe: (() => void) | null
  error: string | null
}

const state: Record<LayerId, TodayState> = {
  raw: { day: '', files: [], unsubscribe: null, error: null },
  bronze: { day: '', files: [], unsubscribe: null, error: null },
}

let onChange: (() => void) | null = null
let started = false

/**
 * Abre las suscripciones de las dos capas y queda a la escucha del cambio
 * de día. `notify` se llama con cada novedad. Idempotente.
 */
export function startTodayTree(notify: () => void): void {
  onChange = notify
  if (started) return
  started = true
  onDayChange(({ to }) => {
    for (const layer of LAYERS) subscribe(layer, to)
    onChange?.()
  })
  for (const layer of LAYERS) subscribe(layer, currentDay())
}

function clientOf(layer: LayerId): TodayTreeClient {
  return {
    today(): LayerDay {
      currentDay() // chequea la medianoche antes de responder
      const st = state[layer]
      let bytes = 0
      for (const file of st.files) bytes += file.size
      return { date: st.day || currentDay(), files: st.files.length, bytes }
    },
    files: (): TodayFile[] => [...state[layer].files],
    error: (): string | null => state[layer].error,
  }
}

export const todayTree: Record<LayerId, TodayTreeClient> = {
  raw: clientOf('raw'),
  bronze: clientOf('bronze'),
}

function subscribe(layer: LayerId, day: IsoDate): void {
  const st = state[layer]
  st.unsubscribe?.()
  st.day = day
  st.files = []
  st.error = null

  st.unsubscribe = getFirestore(firebaseApp())
    .collection(INVENTORY_COLLECTION)
    .doc(layer)
    .collection('days')
    .doc(day)
    .collection('files')
    .onSnapshot(
      (snap) => {
        st.files = snap.docs.map((doc) => {
          const data = doc.data()
          return {
            name: doc.id,
            size: typeof data.size === 'number' ? data.size : 0,
            lastModified: typeof data.lastModified === 'string' ? data.lastModified : null,
          }
        })
        st.error = null
        onChange?.()
      },
      (error) => {
        st.error = error.message
        onChange?.()
      },
    )
}
