import { firebaseApp } from '../firebase'

/**
 * Cliente mínimo de la API de Cloud Monitoring — la misma fuente que los
 * paneles de la consola. Lo comparten las tarjetas de uso de Firebase y de
 * Google Cloud: acá viven el token, la consulta de series y las tres
 * lecturas que existen (sumar un contador en una ventana, sumarlo separado
 * por un label, o el valor actual de un gauge).
 *
 * La consulta es gratis a este volumen (free tier de 1M de lecturas de la
 * API por mes). El token sale de la misma service account del Admin SDK
 * (trae el scope cloud-platform); si no puede leer Monitoring, el error
 * viaja al llamador con el rol que falta.
 */

const MONITORING = 'https://monitoring.googleapis.com/v3'

export const DAY_MS = 24 * 60 * 60_000
export const WEEK_MS = 7 * DAY_MS

export async function accessToken(): Promise<string> {
  const credential = firebaseApp().options.credential
  if (!credential) throw new Error('La app de Firebase no tiene credencial.')
  const token = await credential.getAccessToken()
  return token.access_token
}

interface SeriesPoint {
  value?: { int64Value?: string; doubleValue?: number }
}

export interface Series {
  /** Labels de la métrica (p. ej. `method` en las operaciones de GCS). */
  metric?: { labels?: Record<string, string> }
  points?: SeriesPoint[]
}

/**
 * null = la métrica NO EXISTE en esta API (404): es un caso normal — los
 * nombres cambian entre generaciones y proyectos — no un error para la UI.
 */
async function timeSeries(
  projectId: string,
  token: string,
  params: Record<string, string>,
): Promise<Series[] | null> {
  const query = new URLSearchParams(params).toString()
  const res = await fetch(`${MONITORING}/projects/${projectId}/timeSeries?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`)
  const data = (await res.json()) as { timeSeries?: Series[] }
  return data.timeSeries ?? []
}

const pointValue = (point: SeriesPoint | undefined): number =>
  Number(point?.value?.int64Value ?? point?.value?.doubleValue ?? 0)

/**
 * Suma de un contador (DELTA) en una ventana. Sin series = 0 (no hubo
 * actividad) — salvo `emptyAsNull`, para métricas cuya existencia no está
 * garantizada: ahí la ausencia es "sin datos", no cero.
 */
export async function sumWindow(
  projectId: string,
  token: string,
  metric: string,
  from: string,
  to: string,
  emptyAsNull = false,
): Promise<number | null> {
  const series = await timeSeries(projectId, token, {
    filter: `metric.type="${metric}"`,
    'interval.startTime': from,
    'interval.endTime': to,
    'aggregation.alignmentPeriod': '2678400s',
    'aggregation.perSeriesAligner': 'ALIGN_SUM',
    'aggregation.crossSeriesReducer': 'REDUCE_SUM',
  })
  if (series === null) return null // la métrica no existe: "—", no un 0
  if (emptyAsNull && series.length === 0) return null
  let total = 0
  for (const serie of series) for (const point of serie.points ?? []) total += pointValue(point)
  return total
}

/**
 * Suma de un contador en una ventana, SEPARADA por el valor de un label de
 * la métrica: sin reductor entre series, cada una conserva sus labels y se
 * agrupa acá. null = la métrica no existe.
 */
export async function sumByLabel(
  projectId: string,
  token: string,
  metric: string,
  label: string,
  from: string,
  to: string,
): Promise<Map<string, number> | null> {
  const series = await timeSeries(projectId, token, {
    filter: `metric.type="${metric}"`,
    'interval.startTime': from,
    'interval.endTime': to,
    'aggregation.alignmentPeriod': '2678400s',
    'aggregation.perSeriesAligner': 'ALIGN_SUM',
  })
  if (series === null) return null
  const byLabel = new Map<string, number>()
  for (const serie of series) {
    const key = serie.metric?.labels?.[label] ?? ''
    let total = byLabel.get(key) ?? 0
    for (const point of serie.points ?? []) total += pointValue(point)
    byLabel.set(key, total)
  }
  return byLabel
}

/**
 * El valor actual de un GAUGE: el punto más nuevo de la ventana, sumado
 * entre series (una por base). Sin puntos = null — "—" antes que un cero
 * inventado.
 */
export async function gaugeNow(
  projectId: string,
  token: string,
  metric: string,
  windowMs = 60 * 60_000,
): Promise<number | null> {
  const now = Date.now()
  const series = await timeSeries(projectId, token, {
    filter: `metric.type="${metric}"`,
    'interval.startTime': new Date(now - windowMs).toISOString(),
    'interval.endTime': new Date(now).toISOString(),
  })
  if (series === null) return null // la métrica no existe
  // Los puntos vienen del más nuevo al más viejo: el primero de cada serie.
  let total = 0
  let found = false
  for (const serie of series) {
    const point = serie.points?.[0]
    if (point) {
      total += pointValue(point)
      found = true
    }
  }
  return found ? total : null
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
