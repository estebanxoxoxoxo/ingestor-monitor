import { join } from 'node:path'
import type { EventsPage, EventsQuery } from '@shared/types'
import { query, sqlIdentifier, sqlString } from '../duckdb/duckdb'
import { loadEnv } from '../env'

/**
 * Inspección de raw: las requests HTTP tal cual llegaron al ingestor, antes
 * de cualquier transformación. Vector las escribe como NDJSON comprimido con
 * zstd (`.log.zst`), una línea por flush con `json` = array de entradas
 * `{message, path, source_type, timestamp}` donde `message` es el CUERPO
 * crudo del POST (el batch de RudderStack) como texto.
 *
 * Verificado contra un archivo real del bucket (2026-08-10): DuckDB lee el
 * .zst directo y el unnest expone una fila por request.
 *
 * La tabla muestra pocos campos —recepción, ruta, tamaño, archivo— y el
 * payload completo viaja como texto JSON: la celda lo abre en el popup.
 */

/** El drill-in por día sólo acepta 'YYYY-MM-DD': viaja a un glob de disco. */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** Columnas por las que se puede ordenar. `payload` queda afuera a propósito. */
const SORTABLE = new Set(['recibido', 'ruta', 'bytes_payload', 'archivo'])

function rawDayGlob(day: string): string {
  const env = loadEnv()
  const segments = env.s3.rawPrefix.split('/').filter(Boolean)
  return join(env.rawCacheDir, ...segments, `dt=${day}`, '*')
    .replaceAll('\\', '/')
}

export async function getRawEvents(request: EventsQuery): Promise<EventsPage> {
  const empty: EventsPage = {
    rows: [],
    total: 0,
    limit: request.limit,
    offset: request.offset,
  }

  const day = request.day?.trim() ?? ''
  if (!DAY_RE.test(day)) {
    return { ...empty, error: `"${day}" no es un día válido (YYYY-MM-DD).` }
  }

  const source = `(
    SELECT unnest(json) AS e, filename
    FROM read_json_auto(${sqlString(rawDayGlob(day))}, format = 'newline_delimited', filename = true)
  )`

  const projection = `
    e.timestamp AS recibido,
    e.path AS ruta,
    length(e.message) AS bytes_payload,
    regexp_extract(filename, '[^/\\\\]+$') AS archivo,
    e.message AS payload`

  const direction = request.sortDirection === 'asc' ? 'ASC' : 'DESC'
  const orderBy =
    request.sortColumn && SORTABLE.has(request.sortColumn)
      ? `ORDER BY ${sqlIdentifier(request.sortColumn)} ${direction} NULLS LAST`
      : `ORDER BY recibido DESC`

  try {
    const [rows, [count]] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT * FROM (SELECT ${projection} FROM ${source}) ${orderBy}
         LIMIT ${Number(request.limit)} OFFSET ${Number(request.offset)}`,
      ),
      query<{ total: number }>(`SELECT count(*) AS total FROM ${source}`),
    ])
    return { rows, total: Number(count?.total ?? 0), limit: request.limit, offset: request.offset }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Un día sin archivos en el espejo no es un error: es un día sin datos.
    if (/No files found|IO Error.*match/is.test(message)) return empty
    throw error
  }
}
