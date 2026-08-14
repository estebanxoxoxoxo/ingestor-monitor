import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { config as loadDotenv } from 'dotenv'

/**
 * TODA la plataforma vive en un solo proyecto de Google: la única credencial
 * que la app necesita es la service account de Firebase — con ella firma
 * Firestore (el índice), la RTDB (Vivo) y el lake en Cloud Storage (el
 * viewer y el Full sync). En el .env no existe ninguna otra clave.
 */

export interface AppEnv {
  firebase: {
    projectId: string
    clientEmail: string
    privateKey: string
    /** Realtime Database. Por defecto, la instancia default del proyecto. */
    databaseUrl: string
  }
  lake: {
    /** Bucket del lake. Por defecto se deriva del proyecto: <proyecto>-lake. */
    bucket: string
    /** Prefijo de bronze, terminado en '/'. */
    bronzePrefix: string
    /** Prefijo de raw, terminado en '/'. */
    rawPrefix: string
    /** Clave Hive de la partición por fecha. Ej: 'dt'. */
    datePartitionKey: string
    /** Registro de contratos (catálogo de eventos). Ej: 'schemas/'. */
    schemaPrefix: string
  }
  /** A dónde apunta el semáforo del ingestor (probe TCP). */
  ingest: {
    host: string
    port: number
  }
}

/**
 * En desarrollo el .env vive en la raíz del proyecto. Empaquetado, al lado
 * del ejecutable: no puede ir adentro del asar, que es legible por cualquiera.
 */
function envFilePath(): string {
  const candidates = app.isPackaged
    ? [join(dirname(app.getPath('exe')), '.env')]
    : [join(app.getAppPath(), '.env'), join(process.cwd(), '.env')]
  return candidates.find(existsSync) ?? candidates[0]
}

function required(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name]?.trim()
  if (!value) {
    throw new Error(
      `Falta ${name} en el .env. Copiá .env.example y completalo (buscado en ${envFilePath()}).`,
    )
  }
  return value
}

const withSlash = (value: string): string => (value.endsWith('/') ? value : `${value}/`)

let cached: AppEnv | null = null

export function loadEnv(): AppEnv {
  if (cached) return cached

  const path = envFilePath()
  if (!existsSync(path)) {
    throw new Error(`No encontré el .env en ${path}. Copiá .env.example y completalo.`)
  }
  loadDotenv({ path, quiet: true })
  const e = process.env

  const projectId = required(e, 'FIREBASE_PROJECT_ID')

  cached = {
    firebase: {
      projectId,
      clientEmail: required(e, 'FIREBASE_CLIENT_EMAIL'),
      // En el .env la clave viaja en una línea con \n literales.
      privateKey: required(e, 'FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
      databaseUrl:
        e.FIREBASE_DATABASE_URL?.trim() ||
        `https://${projectId}-default-rtdb.firebaseio.com`,
    },
    lake: {
      bucket: e.LAKE_BUCKET?.trim() || `${projectId}-lake`,
      bronzePrefix: withSlash(e.LAKE_BRONZE_PREFIX?.trim() || 'bronze/v=1/'),
      rawPrefix: withSlash(e.LAKE_RAW_PREFIX?.trim() || 'raw/v=1/'),
      datePartitionKey: e.LAKE_DATE_PARTITION_KEY?.trim() || 'dt',
      schemaPrefix: withSlash(e.LAKE_SCHEMA_PREFIX?.trim() || 'schemas/'),
    },
    // El default es la VM del ingest detrás de Caddy; se ajusta acá sin
    // tocar código.
    ingest: {
      host: e.INGEST_HOST?.trim() || 'actasitalianasexpress.com',
      port: Math.max(1, Number(e.INGEST_PORT) || 443),
    },
  }
  return cached
}
