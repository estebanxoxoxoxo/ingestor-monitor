import { toIsoDate } from '@shared/date'
import type { LayerFreshnessState } from '@shared/types'

/**
 * La regla del punto de cada capa, pura para poder probarla con cualquier
 * reloj. El instante del dato más nuevo lo deduce el vigía DEL LISTADO del
 * bucket (prefijo de época en el nombre de cada archivo, con LastModified
 * de respaldo) — nada local.
 */

const DAY_MS = 86_400_000
const WEEK_DAYS = 7

/**
 * Los cortes, en DÍAS UTC de calendario — nunca ventanas móviles de 24 h
 * (regla de la casa: siempre "hoy", siempre UTC). Verde = hay data de HOY;
 * naranja = lo más nuevo es de ayer a 6 días atrás; violeta = una semana o
 * más; rojo = nunca. Data de ayer 23:59 mirada hoy 00:05 es NARANJA: ayer
 * es ayer aunque hayan pasado seis minutos.
 */
export function classify(lastDataAt: string | null, now = Date.now()): LayerFreshnessState {
  if (!lastDataAt) return 'red'
  const dataDay = Date.parse(`${lastDataAt.slice(0, 10)}T00:00:00Z`)
  const today = Date.parse(`${toIsoDate(new Date(now))}T00:00:00Z`)
  const ageDays = Math.round((today - dataDay) / DAY_MS)
  if (ageDays <= 0) return 'green'
  if (ageDays < WEEK_DAYS) return 'orange'
  return 'violet'
}
