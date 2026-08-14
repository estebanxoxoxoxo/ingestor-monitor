import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { LAYERS, REGENERATE_TREE_COLLECTION } from '@shared/config'
import type { LayerId } from '@shared/config'
import type { RegenerateTreeSnapshot, RegenerateTreeState } from '@shared/types'
import { firebaseApp } from '../firebase'
import { reloadHistoricalTree } from '../ingestor-monitor'

/**
 * REGENERAR EL ÁRBOL EN LA BASE: el remedio del índice, no la rutina. La app
 * no hace el trabajo — deja la orden en Firestore y una Cloud Function
 * reconstruye el índice del lado de Google: lista el bucket, lo compara
 * contra el índice y escribe sólo el diff. La app puede cerrarse mientras
 * tanto.
 *
 * El documento `regenerateTree/{capa}` es las dos cosas a la vez: el pedido
 * que escribe la app y el estado que la función va completando mientras
 * trabaja. Por eso alcanza con una suscripción — el progreso llega solo.
 *
 * Cuando una capa termina se relee la historia del ingestor monitor: los
 * días viejos no tienen suscripción que los despierte, así que su foto en
 * memoria no se enteraría sola de lo que la función acaba de reparar.
 */

/** Lo que la función deja escrito. Todo opcional: el doc puede no existir. */
interface OrderDoc {
  state?: string
  requestedAt?: string
  startedAt?: string
  finishedAt?: string
  daysTotal?: number
  daysDone?: number
  daysRepaired?: number
  writes?: number
  error?: string | null
}

const idle = (layer: LayerId): RegenerateTreeState => ({
  layer,
  state: 'idle',
  requestedAt: null,
  startedAt: null,
  finishedAt: null,
  daysTotal: 0,
  daysDone: 0,
  daysRepaired: 0,
  writes: 0,
})

const state: RegenerateTreeSnapshot = { raw: idle('raw'), bronze: idle('bronze') }
const listeners = new Set<(snapshot: RegenerateTreeSnapshot) => void>()
let started = false

const ordersCol = () => getFirestore(firebaseApp()).collection(REGENERATE_TREE_COLLECTION)

/** Abre la escucha de las dos capas. Idempotente. */
export function startRegenerateTree(): void {
  if (started) return
  started = true
  for (const layer of LAYERS) {
    ordersCol()
      .doc(layer)
      .onSnapshot(
        (snap) => {
          const doc = snap.exists ? (snap.data() as OrderDoc) : null
          const previous = state[layer].state
          state[layer] = toState(layer, doc)
          notify()
          // Terminó recién: el árbol histórico de la app quedó desactualizado.
          if (state[layer].state === 'done' && previous !== 'done') {
            void reloadHistoricalTree(layer)
          }
        },
        (error) => {
          state[layer] = { ...state[layer], state: 'error', error: error.message }
          notify()
        },
      )
  }
}

/** El progreso de las dos capas, en vivo. Devuelve el des-suscriptor. */
export function subscribeRegenerateTree(
  listener: (snapshot: RegenerateTreeSnapshot) => void,
): () => void {
  listeners.add(listener)
  listener(snapshot())
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Deja la orden y devuelve enseguida: el trabajo lo hace la función. El
 * estado se escribe en cero para que el progreso no arranque mostrando el
 * de la corrida anterior.
 */
export async function regenerateTreeInDb(layer: LayerId): Promise<void> {
  await ordersCol().doc(layer).set(
    {
      state: 'requested',
      requestedAt: new Date().toISOString(),
      requestedAtServer: FieldValue.serverTimestamp(),
      startedAt: null,
      finishedAt: null,
      daysTotal: 0,
      daysDone: 0,
      daysRepaired: 0,
      writes: 0,
      error: null,
    },
    { merge: true },
  )
}

const snapshot = (): RegenerateTreeSnapshot => ({ raw: { ...state.raw }, bronze: { ...state.bronze } })

function notify(): void {
  const current = snapshot()
  for (const listener of listeners) listener(current)
}

function toState(layer: LayerId, doc: OrderDoc | null): RegenerateTreeState {
  if (!doc) return idle(layer)
  return {
    layer,
    state: asState(doc.state),
    requestedAt: doc.requestedAt ?? null,
    startedAt: doc.startedAt ?? null,
    finishedAt: doc.finishedAt ?? null,
    daysTotal: doc.daysTotal ?? 0,
    daysDone: doc.daysDone ?? 0,
    daysRepaired: doc.daysRepaired ?? 0,
    writes: doc.writes ?? 0,
    ...(doc.error ? { error: doc.error } : {}),
  }
}

const KNOWN = ['requested', 'running', 'done', 'error'] as const

function asState(value: unknown): RegenerateTreeState['state'] {
  return KNOWN.includes(value as (typeof KNOWN)[number])
    ? (value as RegenerateTreeState['state'])
    : 'idle'
}
