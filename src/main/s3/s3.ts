import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import type { LayerId } from '@shared/config'
import type { IsoDate } from '@shared/date'
import type { AppEnv } from '../env'

export interface RemoteObject {
  key: string
  size: number
  /** Partición diaria a la que pertenece, si la key la declara. */
  date: IsoDate | null
  /** LastModified del objeto, ISO en UTC: el aterrizaje real en el bucket. */
  lastModified: string | null
}

export function createS3Client(env: AppEnv): S3Client {
  return new S3Client({
    region: env.aws.region,
    followRegionRedirects: true,
    ...(env.aws.accessKeyId && env.aws.secretAccessKey
      ? {
          credentials: {
            accessKeyId: env.aws.accessKeyId,
            secretAccessKey: env.aws.secretAccessKey,
          },
        }
      : {}),
  })
}

/** El prefijo de una capa en el bucket. */
export function layerPrefix(env: AppEnv, layer: LayerId): string {
  return layer === 'bronze' ? env.s3.bronzePrefix : env.s3.rawPrefix
}

/** El prefijo de UNA partición diaria de la capa. */
export function dayPrefix(env: AppEnv, layer: LayerId, day: IsoDate): string {
  return `${layerPrefix(env, layer)}${env.s3.datePartitionKey}=${day}/`
}

/** Lista un prefijo completo, paginando (mil claves por request). */
export async function listPrefix(
  client: S3Client,
  env: AppEnv,
  prefix: string,
): Promise<RemoteObject[]> {
  const datePattern = new RegExp(`${env.s3.datePartitionKey}=(\\d{4}-\\d{2}-\\d{2})`)
  const out: RemoteObject[] = []
  let token: string | undefined

  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: env.s3.bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    )
    for (const o of res.Contents ?? []) {
      // Las "carpetas" de la consola son keys de tamaño 0: no son datos.
      if (!o.Key || !o.Size) continue
      out.push({
        key: o.Key,
        size: o.Size,
        date: o.Key.match(datePattern)?.[1] ?? null,
        lastModified: o.LastModified?.toISOString() ?? null,
      })
    }
    token = res.NextContinuationToken
  } while (token)

  return out
}

/** El cuerpo de un objeto como texto, EN MEMORIA — nada toca el disco. */
export async function getObjectText(
  client: S3Client,
  env: AppEnv,
  key: string,
): Promise<string> {
  const res = await client.send(new GetObjectCommand({ Bucket: env.s3.bucket, Key: key }))
  if (!res.Body) throw new Error(`Respuesta sin cuerpo para ${key}`)
  return res.Body.transformToString('utf8')
}
