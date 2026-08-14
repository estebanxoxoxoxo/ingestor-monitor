import { WATCH_INTERVAL_MS } from '@shared/config'
import { todayUtc } from '@shared/date'
import type { IsoDate } from '@shared/date'

/**
 * LA MÁQUINA DEL DÍA. Es la única que mira el reloj: el resto de la app le
 * pregunta qué día es y espera su aviso cuando cambia.
 *
 * Estados: `stopped` → `running` (con `start`). Andando, el ESTADO es el día
 * UTC que la app considera HOY, y la única transición es la medianoche:
 *
 *   día D  ──(el reloj ya dice D+1)──▶  día D+1  +  aviso { from: D, to: D+1 }
 *
 * Se evalúa dos veces: por minuto, para que la vista se entere sin que
 * nadie pregunte, y ANTES de responder `currentDay()` — comparar dos
 * strings es barato, así que ninguna consulta puede salir con un día viejo.
 *
 * El estado se cambia ANTES de avisar: si un oyente vuelve a preguntar en
 * medio del aviso, ve el día nuevo y no dispara otra transición.
 *
 * Quién escucha y qué hace con el aviso:
 *  - `todayTree/`: corta su suscripción a D y abre la de D+1.
 *  - `historicalTree/`: pide los totales de D, que hasta recién sostenía
 *    `todayTree/` y ahora le tocan a la historia.
 */

export interface DayRollover {
  /** El día que se cerró. */
  from: IsoDate
  /** El día que empieza: el HOY nuevo. */
  to: IsoDate
}

type Listener = (rollover: DayRollover) => void

let machineState: 'stopped' | 'running' = 'stopped'
let day: IsoDate = todayUtc()
let timer: NodeJS.Timeout | null = null
const listeners = new Set<Listener>()

/** Arranca el chequeo por minuto. Idempotente. */
export function start(): void {
  if (machineState === 'running') return
  machineState = 'running'
  day = todayUtc()
  timer = setInterval(currentDay, WATCH_INTERVAL_MS)
}

/** Frena la máquina. Sólo lo usan los tests. */
export function stop(): void {
  if (timer) clearInterval(timer)
  timer = null
  machineState = 'stopped'
}

/**
 * El día UTC de HOY. Chequea la transición antes de contestar: quien
 * pregunta nunca recibe un día vencido.
 */
export function currentDay(): IsoDate {
  const now = todayUtc()
  if (now !== day) {
    const from = day
    day = now
    for (const listener of listeners) listener({ from, to: now })
  }
  return day
}

/** Escucha los cambios de día. Devuelve el des-suscriptor. */
export function onDayChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
