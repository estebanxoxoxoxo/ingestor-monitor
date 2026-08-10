import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { eachDay, maxDate, toIsoDate, todayUtc } from '@shared/date'
import type { LayerId } from '@shared/config'
import type {
  LayerDay,
  LayerState,
  SyncFailure,
  SyncProgress,
  SyncResult,
} from '@shared/types'
import { loadEnv } from '../env'
import { invalidateSchema } from '../events/eventsService'
import {
  cachePathFor,
  cacheStats,
  cleanPartFiles,
  discardPartition,
  partitionPath,
  sizeOf,
} from './cache'
import { readSyncState, writeLastSyncAt } from './firestore'
import { layerOf } from './layers'
import { createS3Client, downloadObject, listDay, listPrefix } from './s3'
import type { RemoteObject } from './s3'

export type ProgressFn = (progress: SyncProgress) => void

/**
 * Estado del espejo local de una capa: última sync (Firestore) + inventario
 * por partición diaria (el filesystem ES el inventario, no hay manifest).
 */
export async function getLayerState(id: LayerId): Promise<LayerState> {
  const layer = layerOf(id)
  const [remote, stats, days] = await Promise.all([
    readSyncState(layer.stateDocId),
    cacheStats(layer.cacheDir),
    dayStats(layer.cacheDir, layer.prefix),
  ])
  return {
    layer: id,
    lastSyncAt: remote.lastSyncAt?.toISOString() ?? null,
    cacheDir: layer.cacheDir,
    files: stats.files,
    bytes: stats.bytes,
    days,
  }
}

/** Inventario por día: una fila por carpeta `dt=…` del espejo. */
async function dayStats(cacheDir: string, prefix: string): Promise<LayerDay[]> {
  const env = loadEnv()
  const root = join(cacheDir, ...prefix.split('/').filter(Boolean))
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return [] // el espejo todavía no existe
  }

  const marker = `${env.s3.datePartitionKey}=`
  const days: LayerDay[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(marker)) continue
    const stats = await cacheStats(join(root, entry.name))
    days.push({ date: entry.name.slice(marker.length), files: stats.files, bytes: stats.bytes })
  }
  return days.sort((a, b) => b.date.localeCompare(a.date))
}

/**
 * Trae al espejo local todo lo que haya en la capa desde la última corrida
 * hasta ahora, y registra el instante en Firestore. Reglas de la casa:
 *
 *  - La ventana va del día de `lastSyncAt` hasta HOY inclusive.
 *  - El día en curso se rehace entero (descartado recién después de que el
 *    listado salió bien).
 *  - Los días cerrados son aditivos y no se borran nunca.
 *  - La marca de agua es el instante de INICIO y sólo avanza si no falló nada.
 *
 * Bronze además espeja `schemas/` completo: los contratos viajan con la capa.
 */
export async function runLayerSync(id: LayerId, onProgress: ProgressFn): Promise<SyncResult> {
  const env = loadEnv()
  const layer = layerOf(id)
  const startedAt = new Date()
  const counters = { filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0 }
  const emit = (phase: SyncProgress['phase'], message: string): void =>
    onProgress({ layer: id, phase, message, ...counters })

  emit('reading-state', 'Leyendo la última sincronización…')
  const remote = await readSyncState(layer.stateDocId)

  const today = todayUtc()
  const from = maxDate(
    env.sync.startDate,
    remote.lastSyncAt ? toIsoDate(remote.lastSyncAt) : env.sync.startDate,
  )
  const to = maxDate(from, today)

  await cleanPartFiles(layer.cacheDir)

  // ── Listado ────────────────────────────────────────────────────
  const client = createS3Client(env)
  const days = eachDay(from, to)
  const objects: RemoteObject[] = []

  for (const [i, day] of days.entries()) {
    emit('listing', `Listando ${day} (${i + 1}/${days.length})…`)
    objects.push(...(await listDay(client, env, layer.prefix, day)))
  }

  if (layer.mirrorsSchemas) {
    // El registro de contratos se espeja completo en cada corrida: son unos
    // pocos cientos de bytes y sin él el espejo de bronze queda incompleto.
    emit('listing', 'Listando el registro de esquemas…')
    objects.push(...(await listPrefix(client, env, env.s3.schemaPrefix)))
  }

  // ── Se rehace el día en curso ──────────────────────────────────
  // Recién acá, con el listado ya en la mano.
  const discarded = await discardPartition(
    partitionPath(layer.cacheDir, layer.prefix, env.s3.datePartitionKey, today),
  )
  if (discarded > 0) emit('listing', `Rehaciendo ${today}: ${discarded} archivos descartados.`)

  // ── Diff contra el disco ───────────────────────────────────────
  const pending: RemoteObject[] = []
  let skipped = 0
  for (const object of objects) {
    const localSize = await sizeOf(cachePathFor(layer.cacheDir, object.key))
    if (localSize === object.size) skipped++
    else pending.push(object)
  }

  counters.filesTotal = pending.length
  counters.bytesTotal = pending.reduce((acc, o) => acc + o.size, 0)

  // ── Descarga ───────────────────────────────────────────────────
  const failures: SyncFailure[] = []
  await runPool(pending, env.sync.concurrency, async (object) => {
    try {
      await downloadObject(
        client,
        env.s3.bucket,
        object.key,
        cachePathFor(layer.cacheDir, object.key),
      )
      counters.bytesDone += object.size
    } catch (error) {
      failures.push({ key: object.key, date: object.date, error: messageOf(error) })
    } finally {
      counters.filesDone++
      emit('downloading', `Descargando ${counters.filesDone}/${counters.filesTotal}…`)
    }
  })

  // ── Registro en Firestore ──────────────────────────────────────
  // Con una marca de agua única no se puede afirmar "completo hasta acá" a
  // medias: si algo falló no se mueve, y la próxima corrida repite el rango.
  const ok = failures.length === 0
  if (ok) {
    emit('saving-state', `Registrando la sincronización de ${startedAt.toISOString()}…`)
    await writeLastSyncAt(layer.stateDocId, startedAt)
  }

  // El espejo de bronze cambió: el esquema cacheado puede haber quedado viejo.
  if (layer.mirrorsSchemas && (pending.length > 0 || discarded > 0)) invalidateSchema()

  const downloaded = pending.length - failures.length
  emit(
    ok ? 'done' : 'error',
    ok
      ? `Listo: ${downloaded} archivos nuevos, ${skipped} ya estaban.`
      : `${downloaded} archivos descargados, ${failures.length} fallaron.`,
  )

  return {
    layer: id,
    ok,
    from,
    to,
    downloaded,
    skipped,
    discarded,
    bytes: counters.bytesDone,
    lastSyncAt: ok ? startedAt.toISOString() : (remote.lastSyncAt?.toISOString() ?? null),
    failures,
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Pool de concurrencia fija: N workers consumiendo la misma cola. */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]
      await worker(item)
    }
  })
  await Promise.all(workers)
}
