import { SAMPLE_ROW_CAP } from '@shared/config'
import type { FileSample, FileSampleQuery } from '@shared/types'
import { query, sqlString } from '../duckdb/duckdb'
import { loadEnv } from '../env'
import { dayPrefix } from '../s3/s3'

/**
 * El viewer de UN archivo: DuckDB (httpfs) lo lee directo del bucket y el
 * resultado viaja en memoria — volátil, nada toca el disco. Es la única
 * parte de la app que toca DATA de S3, y siempre de a un archivo: el costo
 * de cada click es exactamente ese objeto.
 *
 * Las credenciales van por el ENTORNO del proceso, jamás en SQL ni en la
 * línea de comandos. La primera consulta instala la extensión httpfs
 * (internet una única vez).
 */

const PRELUDE = `INSTALL httpfs; LOAD httpfs; CREATE SECRET (TYPE s3, PROVIDER credential_chain);`

/** El día viaja a una URL de S3: sólo 'YYYY-MM-DD'. */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
/** El nombre también: un basename sano, sin separadores. */
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,900}$/

function s3Env(): NodeJS.ProcessEnv {
  const env = loadEnv()
  return {
    AWS_REGION: env.aws.region,
    AWS_DEFAULT_REGION: env.aws.region,
    ...(env.aws.accessKeyId ? { AWS_ACCESS_KEY_ID: env.aws.accessKeyId } : {}),
    ...(env.aws.secretAccessKey ? { AWS_SECRET_ACCESS_KEY: env.aws.secretAccessKey } : {}),
  }
}

export async function getFileSample(request: FileSampleQuery): Promise<FileSample> {
  const empty: FileSample = { columns: [], rows: [], truncated: false }

  const day = request.day?.trim() ?? ''
  const file = request.file?.trim() ?? ''
  if (!DAY_RE.test(day)) {
    return { ...empty, error: `"${day}" no es un día válido (YYYY-MM-DD).` }
  }
  if (!FILE_RE.test(file)) {
    return { ...empty, error: `"${file}" no parece un nombre de archivo del bucket.` }
  }

  const env = loadEnv()
  const url = `s3://${env.s3.bucket}/${dayPrefix(env, request.layer, day)}${file}`
  try {
    return request.layer === 'raw' ? await rawFile(url) : await bronzeFile(url)
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Raw: una fila por request HTTP. El payload completo viaja en `registro`
 * (clave que la tabla no dibuja): alimenta el popup de Ver.
 */
async function rawFile(url: string): Promise<FileSample> {
  const rows = await query<Record<string, unknown>>(
    `${PRELUDE}
     SELECT e.timestamp AS recibido,
            e.path AS ruta,
            length(e.message) AS bytes_payload,
            e.message AS registro
     FROM (
       SELECT unnest(json) AS e
       FROM read_json_auto(${sqlString(url)}, format = 'newline_delimited')
     )
     ORDER BY recibido DESC
     LIMIT ${SAMPLE_ROW_CAP + 1}`,
    s3Env(),
  )
  return withCap(['recibido', 'ruta', 'bytes_payload'], rows)
}

/**
 * Bronze: una fila por evento, con TODAS las columnas del parquet (acá no
 * hay contrato que consultar: es inspección de lo que hay). El popup de Ver
 * muestra la fila entera.
 */
async function bronzeFile(url: string): Promise<FileSample> {
  const source = `read_parquet(${sqlString(url)})`

  const described = await query<{ column_name: string }>(
    `${PRELUDE} DESCRIBE SELECT * FROM ${source}`,
    s3Env(),
  )
  const columns = described.map((c) => c.column_name)

  const orderBy = columns.includes('timestamp') ? `ORDER BY "timestamp" DESC NULLS LAST` : ''

  const rows = await query<Record<string, unknown>>(
    `${PRELUDE} SELECT * FROM ${source} ${orderBy} LIMIT ${SAMPLE_ROW_CAP + 1}`,
    s3Env(),
  )
  return withCap(columns, rows)
}

/** LIMIT tope+1: si vino la fila de más, el archivo seguía y se avisa. */
function withCap(columns: string[], rows: Record<string, unknown>[]): FileSample {
  const truncated = rows.length > SAMPLE_ROW_CAP
  return { columns, rows: truncated ? rows.slice(0, SAMPLE_ROW_CAP) : rows, truncated }
}
