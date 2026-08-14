import { Storage } from '@google-cloud/storage'
import type { LayerId } from '@shared/config'
import type { IsoDate } from '@shared/date'
import type { AppEnv } from './env'

/**
 * El lake en Google Cloud Storage. UNA sola identidad para toda la app: la
 * misma service account de Firebase firma Firestore, la RTDB y el bucket —
 * en el .env no existe ninguna otra credencial.
 *
 * La app lo toca en exactamente dos lugares: el viewer (bajar UN archivo,
 * volátil) y el Full sync (el escaneo manual que repara el índice).
 */

export interface RemoteObject {
  key: string
  size: number
  /** Partición diaria a la que pertenece, si la key la declara. */
  date: IsoDate | null
  /** Instante de creación del objeto, ISO en UTC: el aterrizaje real. */
  lastModified: string | null
}

let client: Storage | null = null

export function lakeClient(env: AppEnv): Storage {
  client ??= new Storage({
    projectId: env.firebase.projectId,
    credentials: {
      client_email: env.firebase.clientEmail,
      private_key: env.firebase.privateKey,
    },
  })
  return client
}

/** El prefijo de una capa en el bucket. */
export function layerPrefix(env: AppEnv, layer: LayerId): string {
  return layer === 'bronze' ? env.lake.bronzePrefix : env.lake.rawPrefix
}

/** El prefijo de UNA partición diaria de la capa. */
export function dayPrefix(env: AppEnv, layer: LayerId, day: IsoDate): string {
  return `${layerPrefix(env, layer)}${env.lake.datePartitionKey}=${day}/`
}

/** Lista un prefijo completo, paginando (mil claves por página). */
export async function listPrefix(env: AppEnv, prefix: string): Promise<RemoteObject[]> {
  const datePattern = new RegExp(`${env.lake.datePartitionKey}=(\\d{4}-\\d{2}-\\d{2})`)
  const bucket = lakeClient(env).bucket(env.lake.bucket)
  const out: RemoteObject[] = []

  const [files] = await bucket.getFiles({ prefix })
  for (const file of files) {
    const size = Number(file.metadata.size ?? 0)
    // Las "carpetas" de la consola son objetos de tamaño 0: no son datos.
    if (!file.name || !size) continue
    out.push({
      key: file.name,
      size,
      date: file.name.match(datePattern)?.[1] ?? null,
      lastModified: file.metadata.timeCreated ?? null,
    })
  }
  return out
}

/** El cuerpo de un objeto como texto, EN MEMORIA — nada toca el disco. */
export async function getObjectText(env: AppEnv, key: string): Promise<string> {
  const [buffer] = await lakeClient(env).bucket(env.lake.bucket).file(key).download()
  return buffer.toString('utf8')
}

/** El cuerpo de un objeto como bytes, EN MEMORIA (para el viewer). */
export async function getObjectBytes(env: AppEnv, key: string): Promise<Buffer> {
  const [buffer] = await lakeClient(env).bucket(env.lake.bucket).file(key).download()
  return buffer
}
