/**
 * Fechas del análisis, siempre en UTC (Greenwich).
 *
 * No hay conversión de husos en ninguna parte de la app: la partición
 * `dt=YYYY-MM-DD` del bucket mapea 1:1 con el día de análisis.
 */

const DAY_MS = 86_400_000

/** 'YYYY-MM-DD' en UTC. */
export type IsoDate = string

export function toIsoDate(d: Date): IsoDate {
  return d.toISOString().slice(0, 10)
}

export function todayUtc(): IsoDate {
  return toIsoDate(new Date())
}

function addDays(date: IsoDate, days: number): IsoDate {
  return toIsoDate(new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS))
}

/** Días inclusive de `from` a `to`. Vacío si `from > to`. */
export function eachDay(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/** Las fechas ISO ordenan bien como strings, así que alcanza con comparar. */
export const maxDate = (a: IsoDate, b: IsoDate): IsoDate => (a >= b ? a : b)
