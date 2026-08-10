import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * El espejo local replica la raíz del bucket, no el prefijo: la key
 * `bronze/v=1/dt=2026-08-03/x.parquet` cae en
 * `<cacheDir>/bronze/v=1/dt=2026-08-03/x.parquet`.
 *
 * Mantener los segmentos Hive intactos es lo que después le permite a DuckDB
 * derivar `v` y `dt` como columnas al leer con hive_partitioning.
 */
export function cachePathFor(cacheDir: string, key: string): string {
  return join(cacheDir, ...key.split('/'))
}

/** Carpeta local de una partición diaria. */
export function partitionPath(
  cacheDir: string,
  prefix: string,
  datePartitionKey: string,
  date: string,
): string {
  return join(cacheDir, ...prefix.split('/').filter(Boolean), `${datePartitionKey}=${date}`)
}

/** Tamaño en bytes, o null si no existe. */
export async function sizeOf(path: string): Promise<number | null> {
  try {
    const s = await stat(path)
    return s.isFile() ? s.size : null
  } catch {
    return null
  }
}

export interface CacheStats {
  files: number
  bytes: number
}

/**
 * El filesystem es el inventario: no hay manifest que mantener en sincronía.
 * Los `.part` no cuentan, son descargas a medio terminar.
 */
export async function cacheStats(cacheDir: string): Promise<CacheStats> {
  let files = 0
  let bytes = 0

  await walk(cacheDir, async (path) => {
    files++
    bytes += (await sizeOf(path)) ?? 0
  })

  return { files, bytes }
}

/**
 * Descarta una partición diaria entera para volver a bajarla.
 *
 * Se usa sólo con el día en curso, que sigue recibiendo archivos y por lo
 * tanto es el único que puede quedar desfasado. Los días cerrados nunca se
 * borran: si el bucket pierde datos, la caché los conserva.
 *
 * Devuelve cuántos archivos se descartaron.
 */
export async function discardPartition(path: string): Promise<number> {
  let count = 0
  await walk(path, async () => {
    count++
  })
  await rm(path, { recursive: true, force: true })
  return count
}

/** Restos de descargas interrumpidas. Se limpian en toda la caché. */
export async function cleanPartFiles(cacheDir: string): Promise<number> {
  let removed = 0
  await walk(
    cacheDir,
    async (path) => {
      await rm(path, { force: true })
      removed++
    },
    (name) => name.endsWith('.part'),
  )
  return removed
}

/** Recorre archivos; por defecto ignora los `.part`. */
async function walk(
  dir: string,
  visit: (path: string) => Promise<void>,
  accept: (name: string) => boolean = (name) => !name.endsWith('.part'),
): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return // la carpeta todavía no existe
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, visit, accept)
    else if (entry.isFile() && accept(entry.name)) await visit(full)
  }
}
