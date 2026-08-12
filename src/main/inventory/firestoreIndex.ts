import { AggregateField, FieldPath, getFirestore } from 'firebase-admin/firestore'
import { INVENTORY_COLLECTION } from '@shared/config'
import type { LayerId } from '@shared/config'
import type { IsoDate } from '@shared/date'
import { firebaseApp } from '../firebase'

/**
 * El índice del bucket como relación de colecciones en Firestore:
 *
 *   inventory/{raw|bronze}/days/{YYYY-MM-DD}          → MARCADOR (doc vacío)
 *   inventory/{raw|bronze}/days/{día}/files/{nombre}  → peso y fecha
 *
 * Sólo HECHOS: nada derivado ni calculado (los totales se piden con
 * agregaciones del lado del servidor al leer — viajan números, no docs).
 * Lo escriben dos manos con la misma letra: la Lambda de las notificaciones
 * de S3 (tiempo real, app cerrada) y la app (reconciliación de hoy + full
 * sync). El doc de cada archivo usa el NOMBRE como id: los upserts son
 * idempotentes y pisarse es inofensivo.
 */

export interface StoredFile {
  name: string
  size: number
  lastModified: string | null
}

/** Totales de un día, agregados por el servidor. */
export interface DayTotals {
  files: number
  bytes: number
}

/** Lo que hay que escribir de un día: sólo el diff, nunca el censo. */
export interface DayWrite {
  day: IsoDate
  upserts: StoredFile[]
  removals: string[]
  /** true = el día quedó sin archivos: se borra también su marcador. */
  empty: boolean
}

const DAYS = 'days'
const FILES = 'files'

function daysCol(layer: LayerId) {
  return getFirestore(firebaseApp()).collection(INVENTORY_COLLECTION).doc(layer).collection(DAYS)
}

const asCount = (value: unknown): number => (typeof value === 'number' ? value : 0)
const asIso = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/** Un id de doc válido. Los nombres que escribe Vector siempre lo son. */
const docIdSafe = (name: string): boolean =>
  name.length > 0 && name.length < 1000 && !name.includes('/') && name !== '.' && name !== '..'

const toStored = (doc: FirebaseFirestore.QueryDocumentSnapshot): StoredFile => {
  const data = doc.data()
  return { name: doc.id, size: asCount(data.size), lastModified: asIso(data.lastModified) }
}

/** Los días que existen (los marcadores): el esqueleto del árbol. */
export async function readDayList(layer: LayerId): Promise<IsoDate[]> {
  const snap = await daysCol(layer).get()
  return snap.docs.map((doc) => doc.id)
}

/**
 * Totales de un día SIN leer sus documentos: count + sum los calcula el
 * servidor y a la app viaja el resultado (~1 lectura por cada mil archivos).
 */
export async function aggregateDay(layer: LayerId, day: IsoDate): Promise<DayTotals> {
  const snap = await daysCol(layer)
    .doc(day)
    .collection(FILES)
    .aggregate({ files: AggregateField.count(), bytes: AggregateField.sum('size') })
    .get()
  const data = snap.data()
  return { files: asCount(data.files), bytes: asCount(data.bytes) }
}

/**
 * Los N archivos más nuevos de un día: los nombres arrancan con la época de
 * largo fijo, así que el orden alfabético de ids ES cronológico. Se leen
 * sólo los N pedidos.
 */
export async function newestDayFiles(
  layer: LayerId,
  day: IsoDate,
  limit: number,
): Promise<StoredFile[]> {
  const snap = await daysCol(layer)
    .doc(day)
    .collection(FILES)
    .orderBy(FieldPath.documentId(), 'desc')
    .limit(limit)
    .get()
  return snap.docs.map(toStored)
}

/** Los archivos de UN día: se leen recién cuando alguien lo abre. */
export async function readDayFiles(layer: LayerId, day: IsoDate): Promise<StoredFile[]> {
  const snap = await daysCol(layer).doc(day).collection(FILES).get()
  return snap.docs.map(toStored)
}

/**
 * Suscripción en vivo a los archivos de un día (para HOY): el estado llega
 * una vez y después SOLO los deltas que la Lambda va anotando.
 */
export function subscribeDayFiles(
  layer: LayerId,
  day: IsoDate,
  onFiles: (files: StoredFile[]) => void,
  onError: (error: Error) => void,
): () => void {
  return daysCol(layer)
    .doc(day)
    .collection(FILES)
    .onSnapshot((snap) => onFiles(snap.docs.map(toStored)), onError)
}

/**
 * Aplica diffs de días en un solo BulkWriter (él trocea en lotes y
 * reintenta). Si algo falla tras los reintentos se lanza el primer error:
 * la base en memoria del vigía no avanza y el próximo intento re-escribe
 * lo pendiente.
 */
export async function applyDayWrites(layer: LayerId, writes: DayWrite[]): Promise<void> {
  if (writes.length === 0) return
  const writer = getFirestore(firebaseApp()).bulkWriter()
  let firstError: Error | null = null
  writer.onWriteError((error) => {
    if (error.failedAttempts < 3) return true
    firstError ??= error
    return false
  })
  // El error individual ya quedó en firstError; el catch evita rechazos sin
  // manejar mientras el writer sigue con el resto.
  const enqueue = (write: Promise<unknown>): void => void write.catch(() => {})

  for (const { day, upserts, removals, empty } of writes) {
    const dayRef = daysCol(layer).doc(day)
    for (const file of upserts) {
      if (!docIdSafe(file.name)) continue
      enqueue(
        dayRef.collection(FILES).doc(file.name).set({
          size: file.size,
          lastModified: file.lastModified,
        }),
      )
    }
    for (const name of removals) {
      if (!docIdSafe(name)) continue
      enqueue(dayRef.collection(FILES).doc(name).delete())
    }
    if (empty) {
      enqueue(dayRef.delete())
    } else if (upserts.length > 0) {
      // El marcador del día: set con merge para no tocar nada si ya existe.
      enqueue(dayRef.set({}, { merge: true }))
    }
  }

  await writer.close()
  if (firstError) throw firstError
}
