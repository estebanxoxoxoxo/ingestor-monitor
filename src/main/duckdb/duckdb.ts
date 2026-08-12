/**
 * Capa de acceso a DuckDB.
 *
 * Se invoca el ejecutable `duckdb.exe` como proceso aparte en vez de cargar el
 * binding nativo de npm dentro del proceso. Motivo concreto: Smart App Control
 * bloquea `duckdb.node` porque viene sin firmar, mientras que el ejecutable
 * oficial está firmado por Stichting DuckDB Foundation y corre sin problema.
 * El costo es el arranque del proceso por consulta; a cambio queda velocidad
 * nativa, sin techo de memoria y sin tocar la configuración de seguridad.
 */
import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** 256 MB: un resultado más grande que esto es un bug de la consulta. */
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024

let cachedPath: string | null = null

/**
 * winget no siempre deja un shim en el PATH, así que además de buscarlo ahí
 * se mira dónde lo dejó instalado.
 */
function findDuckdb(): string {
  // Se lee de process.env y no de loadEnv(): el .env ya se volcó ahí, y así
  // esta capa no arrastra a Electron y se puede probar sola.
  const configured = process.env.DUCKDB_PATH?.trim()
  if (configured) {
    if (!existsSync(configured)) {
      throw new Error(`DUCKDB_PATH apunta a ${configured} y ahí no hay nada.`)
    }
    return configured
  }

  const local = process.env.LOCALAPPDATA
  if (local) {
    const shim = join(local, 'Microsoft', 'WinGet', 'Links', 'duckdb.exe')
    if (existsSync(shim)) return shim

    const packages = join(local, 'Microsoft', 'WinGet', 'Packages')
    if (existsSync(packages)) {
      for (const entry of readdirSync(packages)) {
        if (!entry.startsWith('DuckDB.cli')) continue
        const candidate = join(packages, entry, 'duckdb.exe')
        if (existsSync(candidate)) return candidate
      }
    }
  }

  // Última chance: que esté en el PATH.
  return process.platform === 'win32' ? 'duckdb.exe' : 'duckdb'
}

export function duckdbPath(): string {
  cachedPath ??= findDuckdb()
  return cachedPath
}

export class DuckdbNotFoundError extends Error {
  constructor() {
    super(
      'No encontré duckdb. Instalalo con "winget install DuckDB.cli" o poné la ruta en DUCKDB_PATH del .env.',
    )
    this.name = 'DuckdbNotFoundError'
  }
}

/**
 * Corre SQL y devuelve las filas.
 *
 * La zona horaria se fija en UTC en cada invocación: por defecto DuckDB
 * serializa los TIMESTAMP WITH TIME ZONE en la zona local de la máquina, y
 * acá todo el análisis es en UTC.
 *
 * `extraEnv` viaja por el ENTORNO del proceso hijo, nunca por la línea de
 * comandos: es cómo httpfs recibe las credenciales de S3 sin exponerlas en
 * la lista de procesos.
 */
export async function query<T = Record<string, unknown>>(
  sql: string,
  extraEnv?: NodeJS.ProcessEnv,
): Promise<T[]> {
  const binary = duckdbPath()
  try {
    const { stdout } = await execFileAsync(binary, ['-json', '-c', `SET TimeZone='UTC'; ${sql}`], {
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
      ...(extraEnv ? { env: { ...process.env, ...extraEnv } } : {}),
    })
    return parseResults<T>(stdout.trim())
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string }
    if (err.code === 'ENOENT') throw new DuckdbNotFoundError()
    const detail = err.stderr?.trim()
    throw new Error(detail || err.message)
  }
}

/**
 * `-json` imprime UN array por cada sentencia con salida. El prelude de
 * httpfs (`CREATE SECRET`) imprime su `[{"Success": true}]` antes del
 * resultado real, así que vale el ÚLTIMO documento del stdout. Los cortes
 * son inequívocos: dentro de un documento JSON ninguna línea arranca con
 * `[` (los saltos dentro de strings viajan escapados como \n).
 */
function parseResults<T>(text: string): T[] {
  if (!text) return []
  const documents = text.split(/\r?\n(?=\[)/)
  const last = JSON.parse(documents[documents.length - 1]) as T[]
  // Si la consulta no imprimió filas, el último documento es el ack del
  // CREATE SECRET: eso no es data.
  if (
    documents.length >= 1 &&
    last.length === 1 &&
    typeof last[0] === 'object' &&
    last[0] !== null &&
    JSON.stringify(Object.keys(last[0])) === '["Success"]'
  ) {
    return []
  }
  return last
}

/** Literal de string para SQL. */
export function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * Patrón "contiene" para ILIKE … ESCAPE '\'. Los %, _ y \ del usuario son
 * literales, no comodines.
 */
export function likeContains(value: string): string {
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_')
  return sqlString(`%${escaped}%`)
}

/** Identificador para SQL. */
export function sqlIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}
