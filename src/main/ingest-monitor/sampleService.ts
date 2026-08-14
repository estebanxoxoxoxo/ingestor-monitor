import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SAMPLE_ROW_CAP } from '@shared/config'
import type { FileSample, FileSampleQuery } from '@shared/types'
import { query, sqlString } from './duckdb'
import { loadEnv } from '../env'
import { dayPrefix, getObjectBytes } from '../lake'

/**
 * El viewer de UN archivo. Es la única parte de la app que toca DATA del
 * lake, y siempre de a un objeto: el costo de cada click es exactamente ese
 * archivo.
 *
 * Cómo: se baja EN MEMORIA con la misma identidad de Firebase (ninguna
 * credencial extra), se apoya un instante en un temporal del sistema para
 * que DuckDB lo abra, y se borra al salir — pase lo que pase. Nada
 * persistente, nada de claves, nada de red en el SQL.
 */

/** El día viaja a una ruta del lake: sólo 'YYYY-MM-DD'. */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
/** El nombre también: un basename sano, sin separadores. */
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,900}$/

export async function getFileSample(request: FileSampleQuery): Promise<FileSample> {
  const empty: FileSample = { columns: [], rows: [], truncated: false }

  const day = request.day?.trim() ?? ''
  const file = request.file?.trim() ?? ''
  if (!DAY_RE.test(day)) {
    return { ...empty, error: `"${day}" no es un día válido (YYYY-MM-DD).` }
  }
  if (!FILE_RE.test(file)) {
    return { ...empty, error: `"${file}" no parece un nombre de archivo del lake.` }
  }

  const env = loadEnv()
  const key = `${dayPrefix(env, request.layer, day)}${file}`

  let dir: string | null = null
  try {
    const bytes = await getObjectBytes(env, key)

    // El temporal conserva la extensión: DuckDB decide el descompresor por
    // el nombre (.gz, .zst) y el formato por el sufijo.
    dir = mkdtempSync(join(tmpdir(), 'ops-viewer-'))
    const local = join(dir, `${randomUUID()}-${file}`)
    writeFileSync(local, bytes)

    return request.layer === 'raw' ? await rawFile(local) : await bronzeFile(local)
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : String(error) }
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Raw: una fila por request HTTP. El payload completo viaja en `registro`
 * (clave que la tabla no dibuja): alimenta el popup de Ver.
 */
async function rawFile(local: string): Promise<FileSample> {
  const rows = await query<Record<string, unknown>>(
    `SELECT e.timestamp AS recibido,
            e.path AS ruta,
            length(e.message) AS bytes_payload,
            e.message AS registro
     FROM (
       SELECT unnest(json) AS e
       FROM read_json_auto(${sqlString(local)}, format = 'newline_delimited')
     )
     ORDER BY recibido DESC
     LIMIT ${SAMPLE_ROW_CAP + 1}`,
  )
  return withCap(['recibido', 'ruta', 'bytes_payload'], rows)
}

/**
 * Bronze: una fila por evento, con TODAS las columnas del parquet (acá no
 * hay contrato que consultar: es inspección de lo que hay).
 */
async function bronzeFile(local: string): Promise<FileSample> {
  const source = `read_parquet(${sqlString(local)})`

  const described = await query<{ column_name: string }>(`DESCRIBE SELECT * FROM ${source}`)
  const columns = described.map((c) => c.column_name)

  const orderBy = columns.includes('timestamp') ? `ORDER BY "timestamp" DESC NULLS LAST` : ''

  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM ${source} ${orderBy} LIMIT ${SAMPLE_ROW_CAP + 1}`,
  )
  return withCap(columns, rows)
}

/** LIMIT tope+1: si vino la fila de más, el archivo seguía y se avisa. */
function withCap(columns: string[], rows: Record<string, unknown>[]): FileSample {
  const truncated = rows.length > SAMPLE_ROW_CAP
  return { columns, rows: truncated ? rows.slice(0, SAMPLE_ROW_CAP) : rows, truncated }
}
