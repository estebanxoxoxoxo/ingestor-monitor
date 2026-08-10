import { SYNC_STATE_DOC_IDS } from '@shared/config'
import type { LayerId } from '@shared/config'
import { loadEnv } from '../env'

/** Todo lo que distingue a una capa a la hora de sincronizar y vigilar. */
export interface Layer {
  id: LayerId
  /** Prefijo en el bucket, terminado en '/'. */
  prefix: string
  /** Raíz del espejo local (replica la raíz del bucket, no el prefijo). */
  cacheDir: string
  /** Documento de sync_state en Firestore. */
  stateDocId: string
  /**
   * Sólo bronze espeja además el registro de contratos (`schemas/`): los
   * contratos viajan con la capa que declaran, y de ahí salen los labels
   * de la vista Vivo.
   */
  mirrorsSchemas: boolean
}

export function layerOf(id: LayerId): Layer {
  const env = loadEnv()
  if (id === 'bronze') {
    return {
      id,
      prefix: env.s3.bronzePrefix,
      cacheDir: env.cacheDir,
      stateDocId: SYNC_STATE_DOC_IDS.bronze,
      mirrorsSchemas: true,
    }
  }
  return {
    id,
    prefix: env.s3.rawPrefix,
    cacheDir: env.rawCacheDir,
    stateDocId: SYNC_STATE_DOC_IDS.raw,
    mirrorsSchemas: false,
  }
}
