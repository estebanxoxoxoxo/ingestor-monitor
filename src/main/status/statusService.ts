import { LAYERS, STATUS_FEED_LIMIT, WATCH_INTERVAL_MS } from '@shared/config'
import type { LayerId } from '@shared/config'
import { todayUtc } from '@shared/date'
import type { PipelineLogEntry, StatusSnapshot } from '@shared/types'
import { loadEnv } from '../env'
import { layerOf } from '../sync/layers'
import { createS3Client, listDay } from '../sync/s3'
import type { RemoteObject } from '../sync/s3'

export type StatusListener = (snapshot: StatusSnapshot) => void

/**
 * El vigía del pipeline: cada WATCH_INTERVAL_MS lista HOY (UTC) en cada
 * capa, y de ese único listado sale todo lo que Status muestra — el
 * contador del header y el log de ingestados, la MISMA ventana con dos
 * caras: número arriba, detalle abajo, ordenado por el aterrizaje en S3.
 *
 * SIN persistencia: el log vive en memoria y se rearma fresco en cada
 * pasada. El bucket es la única fuente de verdad. Lo anterior a hoy se
 * mira en los espejos de Raw y Bronze, no acá.
 *
 * Una capa que no se puede listar no frena a la otra: su error viaja en el
 * snapshot y sus entradas simplemente no aparecen.
 */

const listeners = new Set<StatusListener>()
let timer: NodeJS.Timeout | null = null
let current: StatusSnapshot = {
  entries: [],
  today: { raw: null, bronze: null },
  layerErrors: {},
}

export function subscribeStatus(listener: StatusListener): () => void {
  listeners.add(listener)
  listener(current)
  return () => {
    listeners.delete(listener)
  }
}

/** Arranca el vigía: una pasada ya mismo y una por minuto. Idempotente. */
export function startWatcher(): void {
  if (timer) return
  void poll()
  timer = setInterval(() => {
    void poll()
  }, WATCH_INTERVAL_MS)
}

async function poll(): Promise<void> {
  const entries: PipelineLogEntry[] = []
  const today: StatusSnapshot['today'] = { raw: null, bronze: null }
  const layerErrors: StatusSnapshot['layerErrors'] = {}

  for (const id of LAYERS) {
    try {
      const objects = await listToday(id)
      today[id] = objects.length
      entries.push(...objects.map((o) => toEntry(id, o)))
    } catch (error) {
      today[id] = null
      layerErrors[id] = error instanceof Error ? error.message : String(error)
    }
  }

  // El libro se lee por el aterrizaje real, lo más nuevo arriba.
  entries.sort((a, b) => (b.lastModified ?? '').localeCompare(a.lastModified ?? ''))

  const next: StatusSnapshot = {
    entries: entries.slice(0, STATUS_FEED_LIMIT),
    today,
    layerErrors,
  }

  if (JSON.stringify(next) !== JSON.stringify(current)) {
    current = next
    for (const listener of listeners) listener(current)
  }
}

/** La partición de HOY (UTC): contador y log comparten esta única ventana. */
function listToday(id: LayerId): Promise<RemoteObject[]> {
  const env = loadEnv()
  const layer = layerOf(id)
  return listDay(createS3Client(env), env, layer.prefix, todayUtc())
}

function toEntry(layer: LayerId, object: RemoteObject): PipelineLogEntry {
  return {
    id: `${layer}--${object.key}`,
    layer,
    key: object.key,
    file: object.key.slice(object.key.lastIndexOf('/') + 1),
    size: object.size,
    lastModified: object.lastModified,
  }
}
