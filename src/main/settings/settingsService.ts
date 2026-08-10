import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { SETTINGS_DOC } from '@shared/config'
import type { AppSettings } from '@shared/types'
import { firebaseApp } from '../firebase'

/**
 * Preferencias de la app en Firestore.
 *
 * Van a la base y no al disco local porque son una decisión de quien analiza,
 * no de la máquina: la misma elección tiene que aparecer al abrir la app en
 * otra computadora, y sobrevivir a que se limpie la caché.
 */
function docRef() {
  return getFirestore(firebaseApp())
    .collection(SETTINGS_DOC.collection)
    .doc(SETTINGS_DOC.docId)
}

const asNames = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

export async function readSettings(): Promise<AppSettings & { eventCatalog: string[] }> {
  const snap = await docRef().get()
  const data = snap.exists ? (snap.data() ?? {}) : {}
  return {
    relevantEvents: asNames(data.relevantEvents),
    eventCatalog: asNames(data.eventCatalog),
  }
}

export async function writeSettings(settings: AppSettings): Promise<void> {
  await docRef().set(
    {
      relevantEvents: settings.relevantEvents,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
}

/** Se escribe aparte para no pisar la elección del usuario. */
export async function writeEventCatalog(names: string[]): Promise<void> {
  await docRef().set(
    { eventCatalog: names, catalogUpdatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  )
}
