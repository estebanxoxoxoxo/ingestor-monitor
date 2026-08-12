import type { EventCatalog, EventDefinition } from '@shared/types'
import { loadEnv } from '../env'
import { createS3Client, getObjectText, listPrefix } from '../s3/s3'
import { declaredEventsOf } from '../schema/registry'
import type { DeclaredEvents } from '../schema/registry'
import { readSettings, writeEventCatalog } from './settingsService'

/**
 * Las cuatro cosas que el catálogo necesita del mundo exterior. Se inyectan
 * para poder probar la precedencia sin un .env, sin S3 y sin Firestore.
 */
export interface CatalogDeps {
  readDeclared: () => Promise<DeclaredEvents | null>
  namesFromCache: () => Promise<string[]>
  readStored: () => Promise<string[]>
  writeStored: (names: string[]) => Promise<void>
}

/**
 * El registro se lee DIRECTO de S3, en memoria (nada local), y se cachea la
 * corrida entera: los contratos cambian con un publish, no por minuto —
 * reabrir la app los relee.
 */
let declaredCache: DeclaredEvents | null | undefined

async function declaredFromS3(): Promise<DeclaredEvents | null> {
  if (declaredCache !== undefined) return declaredCache
  const env = loadEnv()
  const client = createS3Client(env)
  const objects = await listPrefix(client, env, env.s3.schemaPrefix)
  const catalogs = objects.filter((o) => /\/events_v[^/]+\.json$/.test(o.key))

  const parsed: unknown[] = []
  for (const object of catalogs) {
    try {
      parsed.push(JSON.parse(await getObjectText(client, env, object.key)))
    } catch {
      // Un archivo ilegible no voltea el catálogo de las demás versiones.
    }
  }

  declaredCache = declaredEventsOf(parsed)
  return declaredCache
}

const defaultDeps = (): CatalogDeps => ({
  readDeclared: declaredFromS3,
  // Acá no se consulta la data de bronze: sin catálogo declarado en el
  // registro, se cae directo a lo último guardado en Firestore.
  namesFromCache: async () => [],
  readStored: () => readSettings().then((s) => s.eventCatalog),
  writeStored: writeEventCatalog,
})

/**
 * Qué eventos existen.
 *
 * 1. El catálogo DECLARADO en el registro (S3), que es la única fuente que
 *    puede responder "qué eventos son posibles". Si está, manda y nada más.
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
