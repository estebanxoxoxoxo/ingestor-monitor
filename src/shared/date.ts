/**
 * Fechas del análisis, siempre en UTC (Greenwich).
 *
 * Regla de la casa: todo se muestra por DÍA UTC de calendario ("hoy"),
 * nunca por ventanas móviles. La partición `dt=YYYY-MM-DD` del bucket
 * mapea 1:1 con el día de análisis.
 */

/** 'YYYY-MM-DD' en UTC. */
export type IsoDate = string

export function toIsoDate(d: Date): IsoDate {
  return d.toISOString().slice(0, 10)
}

export function todayUtc(): IsoDate {
  return toIsoDate(new Date())
}
