import type { LayerId } from '@shared/config'
import type { IsoDate } from '@shared/date'
import type { DayFiles } from '@shared/types'
import { startHistoricalTree } from './data/historicalTree/historicalTree'
import { notifyTreeChanged, tree } from './data/reconciler/reconciler'
import { startTodayTree } from './data/todayTree/todayTree'
import { start as startTodayFSM } from './todayFSM/todayFSM'

/**
 * La fachada de la sección: enchufa las piezas y expone al IPC lo que la
 * pestaña necesita. Acá no hay lógica — cada cosa vive en su carpeta:
 *
 *   todayFSM/             el source del día: qué día UTC es y cuándo cambia
 *   data/todayTree/       el árbol de hoy, por suscripción
 *   data/historicalTree/  el árbol desde ayer inclusive, por GET
 *   data/reconciler/      el cliente mergeado `tree`: días, totales, frescura
 *   viewer/               abrir y mostrar UN archivo del lake
 *
 * Las tres que leen el índice viven juntas en `data/`.
 *
 * El cableado: la FSM arranca primero porque los dos árboles se cuelgan de
 * su aviso de medianoche; y los dos le notifican al reconciliador, que es el
 * único que habla con la UI.
 *
 * La regeneración del índice NO vive acá: se pide desde `config/`, que es
 * donde está su botón, y sólo vuelve por `reloadHistoricalTree`.
 */

export { subscribeTree, tree } from './data/reconciler/reconciler'
export { reloadHistoricalTree } from './data/historicalTree/historicalTree'
export { getFileSample } from './viewer/viewer'

let started = false

/** Arranca la sección entera. Idempotente. */
export function startIngestorMonitor(): void {
  if (started) return
  started = true
  startTodayFSM()
  startTodayTree(notifyTreeChanged)
  startHistoricalTree(notifyTreeChanged)
}

/** Los archivos de UN día, listos para dibujar. Hoy sale gratis del vivo. */
export async function getDayFiles(layer: LayerId, day: IsoDate): Promise<DayFiles> {
  return tree[layer].files(day)
}
