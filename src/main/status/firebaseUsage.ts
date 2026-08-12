import type { FirebaseUsage } from '@shared/types'
import { loadEnv } from '../env'
import { firebaseApp } from '../firebase'

/**
 * Uso de Firebase vía la API de Cloud Monitoring — la misma fuente que el
 * panel de la consola. Cada métrica se mide en la MISMA ventana que su capa
 * gratuita: lecturas/escrituras/borrados de Firestore por DÍA (UTC); el
 * egreso de Firestore y la bajada de la RTDB por MES; y los gauges
 * (conexiones, almacenado) al valor actual.
 *
 * La consulta es gratis a este volumen (free tier de 1M de lecturas de la
 * API por mes); igual el patrón es el de facturación: UNA al abrir + botón.
 * El token sale de la misma service account del Admin SDK (trae el scope
 * cloud-platform). Si la cuenta no puede leer Monitoring, el error viaja en
 * `error` con el rol que falta.
 */

const MONITORING = 'https://monitoring.googleapis.com/v3'

const DAY_MS = 24 * 60 * 60_000
/**
 * El almacenamiento de la RTDB se muestrea cada VARIOS DÍAS (verificado: 2
 * puntos en una semana), así que su gauge necesita una ventana ancha o
 * parecería vacío teniendo dato.
 */
const WEEK_MS = 7 * DAY_MS

const METRICS = {
  reads: 'firestore.googleapis.com/document/read_count',
  writes: 'firestore.googleapis.com/document/write_count',
  deletes: 'firestore.googleapis.com/document/delete_count',
  // Lo que factura Firestore como "stored data": documentos + índices
  // (verificado contra los metricDescriptors del proyecto). El EGRESO de
  // Firestore no se publica por Monitoring — sólo está en el panel Usage de
  // la consola, así que la app no lo inventa.
  firestoreStorage: 'firestore.googleapis.com/storage/data_and_index_storage_bytes',
  /** El contador mensual propio de Firebase: lo mismo que muestra la consola. */
  rtdbMonthlySent: 'firebasedatabase.googleapis.com/network/monthly_sent',
  rtdbSent: 'firebasedatabase.googleapis.com/network/sent_bytes_count',
  rtdbConnections: 'firebasedatabase.googleapis.com/network/active_connections',
  rtdbStorage: 'firebasedatabase.googleapis.com/storage/total_bytes',
} as const

let cached: FirebaseUsage | null = null
let started = false

export async function getFirebaseUsage(refresh: boolean): Promise<FirebaseUsage> {
  if (cached && !refresh && !cached.error) return cached
  cached = await fetchUsage()
  return cached
}

/** La única consulta automática: al abrir la app. Idempotente. */
export function startFirebaseUsage(): void {
  if (started) return
  started = true
  void getFirebaseUsage(false)
}

async function accessToken(): Promise<string> {
  const credential = firebaseApp().options.credential
  if (!credential) throw new Error('La app de Firebase no tiene credencial.')
  const token = await credential.getAccessToken()
  return token.access_token
}

async function fetchUsage(): Promise<FirebaseUsage> {
  const now = new Date()
  const from = `${now.toISOString().slice(0, 10)}T00:00:00Z`
  // El egreso de Firestore se mide contra el MES: su capa gratuita es mensual.
  const monthFrom = `${now.toISOString().slice(0, 8)}01T00:00:00Z`
  const to = now.toISOString()
  const empty: FirebaseUsage = {
    from,
    to,
    reads: null,
    writes: null,
    deletes: null,
    firestoreStorageBytes: null,
    rtdbDownloadedBytes: null,
    rtdbActiveConnections: null,
    rtdbStorageBytes: null,
    fetchedAt: null,
  }

  let projectId: string
  let token: string
  try {
    projectId = loadEnv().firebase.projectId
    token = await accessToken()
  } catch (error) {
    return { ...empty, error: messageOf(error) }
  }

  // Cada métrica cae por su cuenta a null: un tablero a medias sirve más
  // que ninguno. El primer error se muestra.
  let firstError: string | undefined
  const guard = async (work: Promise<number | null>): Promise<number | null> => {
    try {
      return await work
    } catch (error) {
      firstError ??= messageOf(error)
      return null
    }
  }

  const [reads, writes, deletes, stored, sent, connections, storage] = await Promise.all([
    guard(sumWindow(projectId, token, METRICS.reads, from, to)),
    guard(sumWindow(projectId, token, METRICS.writes, from, to)),
    guard(sumWindow(projectId, token, METRICS.deletes, from, to)),
    // El almacenado se muestrea cada varias horas: ventana ancha para no
    // mostrar "—" cuando el dato existe pero es de esta mañana.
    guard(gaugeNow(projectId, token, METRICS.firestoreStorage, DAY_MS)),
    // La bajada de la RTDB sale del contador mensual de Firebase (el mismo
    // de la consola); si no publicara, se suma el mes a mano.
    guard(monthlySent(projectId, token, monthFrom, to)),
    guard(gaugeNow(projectId, token, METRICS.rtdbConnections)),
    guard(gaugeNow(projectId, token, METRICS.rtdbStorage, WEEK_MS)),
  ])

  return {
    ...empty,
    reads,
    writes,
    deletes,
    firestoreStorageBytes: stored,
    rtdbDownloadedBytes: sent,
    rtdbActiveConnections: connections,
    rtdbStorageBytes: storage,
    fetchedAt: new Date().toISOString(),
    ...(firstError
      ? {
          error: `Cloud Monitoring: ${firstError}${
            /403|PERMISSION_DENIED/i.test(firstError)
              ? ' (la service account necesita el rol roles/monitoring.viewer)'
              : ''
          }`,
        }
      : {}),
  }
}

interface SeriesPoint {
  value?: { int64Value?: string; doubleValue?: number }
}

interface Series {
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
async function sumWindow(
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

/** Los bytes bajados del mes: el contador de Firebase, o la suma a mano. */
async function monthlySent(
  projectId: string,
  token: string,
  monthFrom: string,
  to: string,
): Promise<number | null> {
  const monthly = await gaugeNow(projectId, token, METRICS.rtdbMonthlySent, DAY_MS)
  if (monthly !== null) return monthly
  return sumWindow(projectId, token, METRICS.rtdbSent, monthFrom, to)
}

/**
 * El valor actual de un GAUGE: el punto más nuevo de la ventana, sumado
 * entre series (una por base). Sin puntos = null — "—" antes que un cero
 * inventado.
 */
async function gaugeNow(
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
