import type { FirebaseUsage } from '@shared/types'
import { loadEnv } from '../env'
import {
  DAY_MS,
  WEEK_MS,
  accessToken,
  gaugeNow,
  messageOf,
  sumWindow,
} from './monitoring'

/**
 * Uso de Firebase vía la API de Cloud Monitoring (cliente en
 * `monitoring.ts`). Cada métrica se mide en la MISMA ventana que su capa
 * gratuita: lecturas/escrituras/borrados de Firestore por DÍA (UTC); la
 * bajada de la RTDB por MES; y los gauges (conexiones, almacenado) al
 * valor actual. El patrón de consulta es el de facturación: UNA al abrir
 * la app + botón.
 */

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

async function fetchUsage(): Promise<FirebaseUsage> {
  const now = new Date()
  const from = `${now.toISOString().slice(0, 10)}T00:00:00Z`
  // La bajada de la RTDB se mide contra el MES: su capa gratuita es mensual.
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
    // El almacenamiento de la RTDB se muestrea cada VARIOS DÍAS (verificado:
    // 2 puntos en una semana): ventana ancha o parecería vacío teniendo dato.
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
