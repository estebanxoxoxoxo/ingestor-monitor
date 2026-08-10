import { join } from 'node:path'
import { sqlString } from '../duckdb/duckdb'
import { cacheStats } from '../sync/cache'

/**
 * La única definición de "leer bronze" para DuckDB. La usan la tabla de
 * eventos y toda la capa de silver: si cambia el layout de la caché, cambia
 * acá y en ningún otro lado.
 *
 * `union_by_name` es lo que permite leer juntos Parquets con distinta cantidad
 * de columnas; sin eso, la mezcla de archivos de 15 y de 17 columnas rompe.
 */
export function bronzeSource(cacheDir: string, options: { filename?: boolean } = {}): string {
  const glob = join(cacheDir, 'bronze', '**', '*.parquet').replaceAll('\\', '/')
  const filename = options.filename ? ', filename = true' : ''
  return `read_parquet(${sqlString(glob)}, hive_partitioning = true, union_by_name = true${filename})`
}

export async function bronzeIsEmpty(cacheDir: string): Promise<boolean> {
  const stats = await cacheStats(join(cacheDir, 'bronze'))
  return stats.files === 0
}
