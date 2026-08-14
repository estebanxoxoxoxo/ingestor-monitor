import { LAYERS } from '@shared/config'
import type { GcpUsage } from '@shared/types'
import { loadEnv } from '../env'
import { tree } from '../ingestor-monitor'
import { gcsOpsByClass } from './gcsOps'
import { DAY_MS, accessToken, gaugeNow, messageOf, sumByLabel, sumWindow } from './monitoring'

/**
 * Uso de la infraestructura de Google Cloud del ingestor — las variables
 * que mueven la factura, cada una en la MISMA unidad y ventana que su capa
 * Always Free (los topes exactos viven en la UI, junto a los porcentajes):
 * operaciones y servido de GCS, salida de red de la VM, ejecuciones de la
 * función del índice y bytes de Pub/Sub por MES CALENDARIO (UTC); los
 * almacenados, al valor actual. Firestore y la RTDB tienen su propia
 * tarjeta (`firebaseUsage`).
 *
 * El almacenado del LAKE no sale de Monitoring — el gauge diario de GCS
 * todavía no publica en este proyecto (verificado: 0 puntos en 8 días) y
 * sería una segunda fuente — sino del árbol mergeado que la app ya tiene en
 * memoria: la única vista del lake que reconoce, y gratis.
 */

const METRICS = {
  /** Operaciones por método (todos los buckets del proyecto). */
  gcsRequests: 'storage.googleapis.com/api/request_count',
  /** Bytes que GCS respondió, a cualquier destino. */
  gcsSent: 'storage.googleapis.com/network/sent_bytes_count',
  /** Bytes salidos de la VM, a cualquier destino. */
  vmSent: 'compute.googleapis.com/instance/network/sent_bytes_count',
  /** Ejecuciones de las funciones (acá: sólo index-writer). */
  functionRuns: 'cloudfunctions.googleapis.com/function/execution_count',
  /** Bytes tasados de Pub/Sub (publicación + entrega). */
  pubsubBytes: 'pubsub.googleapis.com/topic/byte_cost',
  /** Tamaño de los repos de Artifact Registry (las imágenes de la función). */
  artifactStorage: 'artifactregistry.googleapis.com/repository/size',
} as const

/**
 * El tamaño del repo de imágenes se muestrea cada varias horas y cambia
 * sólo al desplegar la función: ventana de un día y una hora para agarrar
 * el último punto sin mostrar "—" teniendo dato.
 */
const GAUGE_WINDOW_MS = DAY_MS + 60 * 60_000

let cached: GcpUsage | null = null
let started = false

export async function getGcpUsage(refresh: boolean): Promise<GcpUsage> {
  if (!cached || refresh || cached.error) cached = await fetchUsage()
  // El almacenado del lake se lee SIEMPRE del árbol en memoria: es gratis,
  // y así acompaña al índice aunque la consulta esté cacheada.
  return { ...cached, lakeStorageBytes: lakeBytes() }
}

/** La única consulta automática: al abrir la app. Idempotente. */
export function startGcpUsage(): void {
  if (started) return
  started = true
  void getGcpUsage(false)
}

/** raw + bronze según el árbol mergeado; null hasta que la historia cargue. */
function lakeBytes(): number | null {
  let total = 0
  let loaded = false
  for (const layer of LAYERS) {
    if (tree[layer].loaded()) loaded = true
    for (const day of tree[layer].days()) total += day.bytes
  }
  return loaded ? total : null
}

async function fetchUsage(): Promise<GcpUsage> {
  const now = new Date()
  const from = `${now.toISOString().slice(0, 8)}01T00:00:00Z`
  const to = now.toISOString()
  const empty: GcpUsage = {
    from,
    to,
    lakeStorageBytes: null,
    gcsClassAOps: null,
    gcsClassBOps: null,
    gcsSentBytes: null,
    vmSentBytes: null,
    functionInvocations: null,
    pubsubBytes: null,
    artifactStorageBytes: null,
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
  const guard = async <T>(work: Promise<T | null>): Promise<T | null> => {
    try {
      return await work
    } catch (error) {
      firstError ??= messageOf(error)
      return null
    }
  }

  const [ops, gcsSent, vmSent, runs, pubsub, artifact] = await Promise.all([
    guard(sumByLabel(projectId, token, METRICS.gcsRequests, 'method', from, to)),
    guard(sumWindow(projectId, token, METRICS.gcsSent, from, to)),
    guard(sumWindow(projectId, token, METRICS.vmSent, from, to)),
    guard(sumWindow(projectId, token, METRICS.functionRuns, from, to)),
    guard(sumWindow(projectId, token, METRICS.pubsubBytes, from, to)),
    guard(gaugeNow(projectId, token, METRICS.artifactStorage, GAUGE_WINDOW_MS)),
  ])

  const clases = ops ? gcsOpsByClass(ops) : null

  return {
    ...empty,
    gcsClassAOps: clases ? clases.a : null,
    gcsClassBOps: clases ? clases.b : null,
    gcsSentBytes: gcsSent,
    vmSentBytes: vmSent,
    functionInvocations: runs,
    pubsubBytes: pubsub,
    artifactStorageBytes: artifact,
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
