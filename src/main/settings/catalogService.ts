import type { EventCatalog, EventDefinition } from '@shared/types'
import { loadEnv } from '../env'
import { readDeclaredEvents } from '../schema/registry'
import type { DeclaredEvents } from '../schema/registry'
import { readSettings, writeEventCatalog } from './settingsService'

/**
 * Las cuatro cosas que el catálogo necesita del mundo exterior. Se inyectan
 * para poder probar la precedencia sin un .env, sin caché y sin Firestore.
 */
export interface CatalogDeps {
  readDeclared: () => Promise<DeclaredEvents | null>
  namesFromCache: () => Promise<string[]>
  readStored: () => Promise<string[]>
  writeStored: (names: string[]) => Promise<void>
}

const defaultDeps = (): CatalogDeps => ({
  readDeclared: () => readDeclaredEvents(loadEnv().cacheDir),
  // Acá no se consulta la data de bronze: sin catálogo declarado en los
  // contratos espejados, se cae directo a lo último guardado en Firestore.
  namesFromCache: async () => [],
  readStored: () => readSettings().then((s) => s.eventCatalog),
  writeStored: writeEventCatalog,
})

/**
 * Qué eventos existen.
 *
 * 1. El catálogo DECLARADO en el registro, que es la única fuente que puede
 *    responder "qué eventos son posibles". Si está, manda y nada más.
 * 2. Si no está publicado, se deduce de la caché. Eso es un muestreo de lo que
 *    ocurrió, no la lista de lo posible: un evento que existe en el SDK pero
 *    que nadie disparó en los días cacheados no aparece.
 * 3. Si la caché está vacía, lo último que se guardó en Firestore.
 *
 * Lo deducido REEMPLAZA lo guardado, no se le suma: acumulando, un evento que
 * entró una vez quedaría en la lista para siempre.
 */
export async function getEventCatalog(
  deps: CatalogDeps = defaultDeps(),
): Promise<EventCatalog> {
  const declared = await deps.readDeclared()
  if (declared) return { events: declared.events, groups: declared.groups, declared: true }

  const fromCache = await deps.namesFromCache().catch(() => [] as string[])
  const stored = await deps.readStored()
  const names = fromCache.length > 0 ? fromCache : stored

  const sorted = [...names].sort((a, b) => a.localeCompare(b))
  if (fromCache.length > 0 && JSON.stringify(stored) !== JSON.stringify(sorted)) {
    await deps.writeStored(sorted)
  }

  // Sin declaración no hay label ni grupo: se usa el nombre técnico.
  const events: EventDefinition[] = sorted.map((name) => ({
    name,
    label: name,
    group: null,
    values: [],
  }))
  return { events, groups: [], declared: false }
}
