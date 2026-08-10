import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'
import { SYNC_STATE_COLLECTION } from '@shared/config'
import { firebaseApp } from '../firebase'

let db: Firestore | null = null

function firestore(): Firestore {
  db ??= getFirestore(firebaseApp())
  return db
}

/** Un documento de estado por capa (bronze conserva su docId histórico). */
function docRef(docId: string) {
  return firestore().collection(SYNC_STATE_COLLECTION).doc(docId)
}

export interface RemoteSyncState {
  /** Instante de la última sincronización exitosa. */
  lastSyncAt: Date | null
  updatedAt: string | null
}

export async function readSyncState(docId: string): Promise<RemoteSyncState> {
  const snap = await docRef(docId).get()
  if (!snap.exists) return { lastSyncAt: null, updatedAt: null }

  const data = snap.data() ?? {}
  const updatedAt = data.updatedAt

  return {
    lastSyncAt: data.lastSyncAt instanceof Timestamp ? data.lastSyncAt.toDate() : null,
    updatedAt: updatedAt instanceof Timestamp ? updatedAt.toDate().toISOString() : null,
  }
}

/**
 * Registra cuándo empezó la corrida, no cuándo terminó: un archivo escrito por
 * Vector mientras la sync corría quedaría del lado equivocado del corte.
 */
export async function writeLastSyncAt(docId: string, startedAt: Date): Promise<void> {
  await docRef(docId).set(
    {
      lastSyncAt: Timestamp.fromDate(startedAt),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
}
