import type { EventColumn, EventsPage, EventsQuery, SchemaInfo } from '@shared/types'
import { bronzeIsEmpty, bronzeSource } from '../bronze/source'
import { query, sqlIdentifier, sqlString } from '../duckdb/duckdb'
import { loadEnv } from '../env'
import { readSchemaFile } from '../schema/registry'

const emptySchema = (error?: string): SchemaInfo => ({
  versions: [],
  messageName: null,
  columns: [],
  sources: [],
  error,
})

/**
 * El esquema sólo cambia cuando cambia la caché, y eso sólo pasa al
 * sincronizar. Sin este caché, cada consulta de la tabla relee el `.schema`
 * del disco y lanza un proceso de DuckDB de más.
 */
let schemaCache: SchemaInfo | null = null

export function invalidateSchema(): void {
  schemaCache = null
}

/**
 * Pide a la data qué versiones de esquema contiene y trae el contrato de cada
 * una. Si conviven varias versiones, las columnas se unen respetando el orden
 * de declaración y sin repetir.
 */
export async function getSchema(): Promise<SchemaInfo> {
  if (schemaCache) return schemaCache
  const result = await readSchema()
  // Los estados de error no se cachean: dependen de que la caché esté vacía y
  // se resuelven solos en cuanto haya datos.
  if (result.columns.length > 0) schemaCache = result
  return result
}

async function readSchema(): Promise<SchemaInfo> {
  const { cacheDir } = loadEnv()

  if (await bronzeIsEmpty(cacheDir)) {
    return emptySchema('El espejo está vacío. Corré Bronze sync para traer los Parquets.')
  }

  const rows = await query<{ schema_version: string | null }>(
    `SELECT DISTINCT schema_version FROM ${bronzeSource(cacheDir)} ORDER BY 1`,
  )
  const versions = rows.map((r) => r.schema_version).filter((v): v is string => Boolean(v))

  if (versions.length === 0) {
    return emptySchema('Los Parquets no declaran schema_version.')
  }

  const columns: EventColumn[] = []
  const seen = new Set<string>()
  const sources: string[] = []
  let messageName: string | null = null
  const missing: string[] = []

  for (const version of versions) {
    try {
      const parsed = await readSchemaFile(cacheDir, version)
      messageName ??= parsed.messageName
      sources.push(parsed.source)
      for (const column of parsed.columns) {
        if (seen.has(column.name)) continue
        seen.add(column.name)
        columns.push(column)
      }
    } catch {
      missing.push(version)
    }
  }

  if (columns.length === 0) {
    return emptySchema(
      `No encontré el contrato de la versión ${missing.join(', ')} en la caché. Sincronizá de nuevo.`,
    )
  }

  return {
    versions,
    messageName,
    columns,
    sources,
    error: missing.length
      ? `Falta el contrato de la versión ${missing.join(', ')}; sus columnas propias no se muestran.`
      : undefined,
  }
}

/** El drill-in por día filtra por la partición: sólo entra 'YYYY-MM-DD'. */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export async function getEvents(request: EventsQuery): Promise<EventsPage> {
  const { cacheDir } = loadEnv()
  const empty: EventsPage = {
    rows: [],
    total: 0,
    limit: request.limit,
    offset: request.offset,
  }

  if (await bronzeIsEmpty(cacheDir)) return empty

  const schema = await getSchema()
  if (schema.columns.length === 0) return { ...empty, error: schema.error }

  const from = bronzeSource(cacheDir)
  const projection = schema.columns.map((c) => sqlIdentifier(c.name)).join(', ')

  // El corte por día usa la columna `dt` que deriva del particionado Hive.
  const day = request.day?.trim() ?? ''
  if (day && !DAY_RE.test(day)) {
    return { ...empty, error: `"${day}" no es un día válido (YYYY-MM-DD).` }
  }
  const where = day ? `WHERE dt = ${sqlString(day)}` : ''

  // Sólo se ordena por una columna declarada: nada que venga del renderer se
  // interpola sin pasar por esta comprobación.
  const sortable = schema.columns.some((c) => c.name === request.sortColumn)
  const direction = request.sortDirection === 'asc' ? 'ASC' : 'DESC'
  const orderBy =
    sortable && request.sortColumn
      ? `ORDER BY ${sqlIdentifier(request.sortColumn)} ${direction} NULLS LAST`
      : ''

  const [rows, [count]] = await Promise.all([
    query<Record<string, unknown>>(
      `SELECT ${projection} FROM ${from} ${where} ${orderBy} LIMIT ${Number(request.limit)} OFFSET ${Number(request.offset)}`,
    ),
    query<{ total: number }>(`SELECT count(*) AS total FROM ${from} ${where}`),
  ])

  return {
    rows,
    total: Number(count?.total ?? 0),
    limit: request.limit,
    offset: request.offset,
  }
}
