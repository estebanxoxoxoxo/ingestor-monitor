import type { EventCatalog, EventDefinition } from '@shared/types'
import { loadEnv } from '../env'
import { getObjectText } from '../lake'
import { declaredEventsOf } from './registry'
import type { DeclaredEvents } from './registry'
import { readSettings, writeEventCatalog } from './settingsService'

/**
 * Las cuatro cosas que el catálogo necesita del mundo exterior. Se inyectan
 * para poder probar la precedencia sin un .env, sin el lake y sin Firestore.
 */
export interface CatalogDeps {
  readDeclared: () => Promise<DeclaredEvents | null>
  namesFromCache: () => Promise<string[]>
  readStored: () => Promise<string[]>
  writeStored: (names: string[]) => Promise<void>
}

/**
 * El catálogo declarado es `schemas/event-types.json` del lake: lo publica
 * la suite desde sus propios enums (behavior + business) con
 * `npm run publish:event-types` en el repo `events-suite`. Se lee DIRECTO
 * del lake, en memoria, y se cachea la corrida entera: los contratos
 * cambian con un publish, no por minuto — reabrir la app los relee.
 */
let declaredCache: DeclaredEvents | null | undefined

async function declaredFromLake(): Promise<DeclaredEvents | null> {
  if (declaredCache !== undefined) return declaredCache
  const env = loadEnv()
  try {
    const text = await getObjectText(env, `${env.lake.schemaPrefix}event-types.json`)
    declaredCache = declaredEventsOf([JSON.parse(text)])
  } catch {
    // Sin catálogo publicado (o ilegible): se cae a lo guardado en Firestore.
    declaredCache = null
  }
  return declaredCache
}

const defaultDeps = (): CatalogDeps => ({
  readDeclared: declaredFromLake,
  // Acá no se consulta la data de bronze: sin catálogo declarado en el
  // registro, se cae directo a lo último guardado en Firestore.
  namesFromCache: async () => [],
  readStored: () => readSettings().then((s) => s.eventCatalog),
  writeStored: writeEventCatalog,
})

/**
 * Qué eventos existen.
 *
 * 1. El catálogo DECLARADO en el registro (el lake), que es la única fuente
 *    que puede responder "qué eventos son posibles". Si está, manda.
 * 2. `namesFromCache` queda como paso inyectable para pruebas; en esta app
 *    no muestrea data (devuelve vacío).
 * 3. Sin declaración, lo último que se guardó en Firestore.
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
