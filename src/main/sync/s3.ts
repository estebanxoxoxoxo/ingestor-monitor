import { createWriteStream } from 'node:fs'
import { mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import type { IsoDate } from '@shared/date'
import type { AppEnv } from '../env'

export interface RemoteObject {
  key: string
  size: number
  /** Partición diaria a la que pertenece, si la key la declara. */
  date: IsoDate | null
  /** LastModified del objeto, ISO en UTC. El watcher lo registra en el log. */
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

/** Lista un prefijo completo, paginando. */
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

/**
 * Una partición diaria de la capa dada. Se lista día por día en vez de todo
 * el prefijo de una porque así la ventana queda acotada y el policy de IAM
 * puede seguir exigiendo prefijo.
 */
export function listDay(
  client: S3Client,
  env: AppEnv,
  layerPrefix: string,
  date: IsoDate,
): Promise<RemoteObject[]> {
  return listPrefix(client, env, `${layerPrefix}${env.s3.datePartitionKey}=${date}/`)
}

/**
 * Descarga a un `.part` y recién ahí renombra. Sin esto, un corte a mitad de
 * descarga dejaría un archivo incompleto que el diff siguiente daría por bueno.
 */
export async function downloadObject(
  client: S3Client,
  bucket: string,
  key: string,
  destPath: string,
): Promise<void> {
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  if (!res.Body) throw new Error(`Respuesta sin cuerpo para ${key}`)

  await mkdir(dirname(destPath), { recursive: true })
  const partPath = `${destPath}.part`
  await pipeline(res.Body as NodeJS.ReadableStream, createWriteStream(partPath))
  await rename(partPath, destPath)
}
