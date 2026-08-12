import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { config as loadDotenv } from 'dotenv'

export interface AppEnv {
  aws: {
    region: string
    accessKeyId?: string
    secretAccessKey?: string
  }
  s3: {
    bucket: string
    /** Prefijo de bronze, terminado en '/'. Ej: 'bronze/v=1/'. */
    bronzePrefix: string
    /** Prefijo de raw, terminado en '/'. Ej: 'raw/v=1/'. */
    rawPrefix: string
    /** Clave Hive de la partición por fecha. Ej: 'dt'. */
    datePartitionKey: string
    /** Registro de contratos. Ej: 'schemas/'. */
    schemaPrefix: string
  }
  /** A dónde apunta el semáforo del ingestor (probe TCP). */
  ingest: {
    host: string
    port: number
  }
  firebase: {
    projectId: string
    clientEmail: string
    privateKey: string
    /** Realtime Database. Por defecto, la instancia default del proyecto. */
    databaseUrl: string
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

  const schemaPrefix = e.S3_SCHEMA_PREFIX?.trim() || 'schemas/'

  cached = {
    aws: {
      region: required(e, 'AWS_REGION'),
      accessKeyId: e.AWS_ACCESS_KEY_ID?.trim() || undefined,
      secretAccessKey: e.AWS_SECRET_ACCESS_KEY?.trim() || undefined,
    },
    s3: {
      // S3_PREFIX conserva el nombre histórico de la variable: el .env se
      // heredó por copia y bronze significa lo mismo que siempre.
      bucket: required(e, 'S3_BUCKET'),
      bronzePrefix: withSlash(required(e, 'S3_PREFIX')),
      rawPrefix: withSlash(e.S3_RAW_PREFIX?.trim() || 'raw/v=1/'),
      datePartitionKey: e.S3_DATE_PARTITION_KEY?.trim() || 'dt',
      schemaPrefix: withSlash(schemaPrefix),
    },
    // El default es la EC2 del ingest detrás de Caddy; se ajusta acá sin
    // tocar código.
    ingest: {
      host: e.INGEST_HOST?.trim() || 'actasitalianasexpress.com',
      port: Math.max(1, Number(e.INGEST_PORT) || 443),
    },
    firebase: {
      projectId: required(e, 'FIREBASE_PROJECT_ID'),
      clientEmail: required(e, 'FIREBASE_CLIENT_EMAIL'),
      // En el .env la clave viaja en una línea con \n literales.
      privateKey: required(e, 'FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
      databaseUrl:
        e.FIREBASE_DATABASE_URL?.trim() ||
        `https://${required(e, 'FIREBASE_PROJECT_ID')}-default-rtdb.firebaseio.com`,
    },
  }
  return cached
}
