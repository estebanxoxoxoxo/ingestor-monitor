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
 * volátil) y el catálogo de eventos (un JSON declarado). El resto se lee
 * del índice en Firestore, nunca del bucket.
 */

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
