import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { FRESHNESS_INTERVAL_MS, LAYERS } from '@shared/config'
import type { LayerId } from '@shared/config'
import { toIsoDate } from '@shared/date'
import type { FreshnessSnapshot, LayerFreshnessState } from '@shared/types'
import { loadEnv } from '../env'
import { layerOf } from '../sync/layers'

export type FreshnessListener = (snapshot: FreshnessSnapshot) => void

/**
 * El punto de cada pestaña: qué tan fresco está el ESPEJO LOCAL de la capa.
 * Cero requests — un escaneo de disco por minuto (y uno extra al terminar
 * cada sync, para que el color cambie al toque). Acá no importa S3: si el
 * bucket tiene data nueva pero no sincronizaste, el punto lo dice.
 *
 * El instante del dato más nuevo sale del PREFIJO DE ÉPOCA con el que Vector
 * nombra cada archivo (`1786365397-<uuid>…`): es la hora del flush, viaja en
 * el nombre y no requiere abrir nada. Si un archivo no lo trae, se cae a la
 * fecha de su partición `dt=` (00:00 UTC de ese día).
 */

const DAY_MS = 86_400_000
const WEEK_DAYS = 7

const listeners = new Set<FreshnessListener>()
let timer: NodeJS.Timeout | null = null
let current: FreshnessSnapshot = {
  raw: { state: 'red', lastDataAt: null },
  bronze: { state: 'red', lastDataAt: null },
}

export function subscribeFreshness(listener: FreshnessListener): () => void {
  listeners.add(listener)
  listener(current)
  return () => {
    listeners.delete(listener)
  }
}

/** Arranca el ciclo: un escaneo ya mismo y uno por minuto. Idempotente. */
export function startFreshness(): void {
  if (timer) return
  void scan()
  timer = setInterval(() => {
    void scan()
  }, FRESHNESS_INTERVAL_MS)
}

/** Re-escaneo inmediato: lo llama la sync al terminar, para no esperar. */
export function pokeFreshness(): void {
  void scan()
}

async function scan(): Promise<void> {
  const next: FreshnessSnapshot = { ...current }
  for (const id of LAYERS) {
    const lastDataAt = await newestInstant(id)
    next[id] = { state: classify(lastDataAt), lastDataAt }
  }

  if (JSON.stringify(next) !== JSON.stringify(current)) {
    current = next
    for (const listener of listeners) listener(current)
  }
}

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

/** El instante más nuevo del espejo de la capa, o null si está vacío. */
async function newestInstant(id: LayerId): Promise<string | null> {
  const env = loadEnv()
  const layer = layerOf(id)
  const root = join(layer.cacheDir, ...layer.prefix.split('/').filter(Boolean))
  const marker = `${env.s3.datePartitionKey}=`

  let days
  try {
    days = await readdir(root, { withFileTypes: true })
  } catch {
    return null // el espejo todavía no existe
  }

  let newest = 0
  for (const day of days) {
    if (!day.isDirectory() || !day.name.startsWith(marker)) continue
    const partitionMs = Date.parse(`${day.name.slice(marker.length)}T00:00:00Z`)

    let files: string[]
    try {
      files = await readdir(join(root, day.name))
    } catch {
      continue
    }

    for (const file of files) {
      if (file.endsWith('.part')) continue
      const epoch = file.match(/^(\d{10})\D/)
      const instant = epoch ? Number(epoch[1]) * 1000 : partitionMs
      if (Number.isFinite(instant) && instant > newest) newest = instant
    }
  }

  return newest > 0 ? new Date(newest).toISOString() : null
}
