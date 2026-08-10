import { describe, expect, it, vi } from 'vitest'
import { getEventCatalog } from '../src/main/settings/catalogService'
import type { CatalogDeps } from '../src/main/settings/catalogService'
import type { DeclaredEvents } from '../src/main/schema/registry'

const DECLARADO: DeclaredEvents = {
  events: [{ name: 'cta_click', label: 'CTA click', group: 'business', values: [] }],
  groups: [{ name: 'business', label: 'Business', columns: 3 }],
}

const deps = (over: Partial<CatalogDeps> = {}): CatalogDeps => ({
  readDeclared: async () => null,
  namesFromCache: async () => [],
  readStored: async () => [],
  writeStored: async () => {},
  ...over,
})

describe('getEventCatalog — precedencia de fuentes', () => {
  /*
   * Tres ejes binarios: archivo declarado, caché con datos, Firestore con algo
   * guardado. Ocho combinaciones, todas afirmadas — es la lógica que decide qué
   * eventos ve el usuario y es fácil romperla sin notarlo.
   */
  const ejes = [false, true]
  for (const conDeclarado of ejes) {
    for (const conCache of ejes) {
      for (const conGuardado of ejes) {
        const titulo =
          `declarado=${conDeclarado ? 'sí' : 'no'} ` +
          `caché=${conCache ? 'con datos' : 'vacía'} ` +
          `firestore=${conGuardado ? 'con datos' : 'vacío'}`

        it(titulo, async () => {
          const writeStored = vi.fn(async () => {})
          const catalog = await getEventCatalog(
            deps({
              readDeclared: async () => (conDeclarado ? DECLARADO : null),
              namesFromCache: async () => (conCache ? ['depth_scroll', 'bounce'] : []),
              readStored: async () => (conGuardado ? ['viejo_guardado'] : []),
              writeStored,
            }),
          )

          if (conDeclarado) {
            // El declarado manda y nada más: ni la caché ni Firestore lo tocan.
            expect(catalog.declared).toBe(true)
            expect(catalog.events.map((e) => e.name)).toEqual(['cta_click'])
            expect(catalog.groups.map((g) => g.name)).toEqual(['business'])
            expect(writeStored).not.toHaveBeenCalled()
            return
          }

          expect(catalog.declared).toBe(false)
          expect(catalog.groups).toEqual([])

          if (conCache) {
            // Lo deducido REEMPLAZA lo guardado; si acumulara, un evento de
            // prueba que entró una vez quedaría en la lista para siempre.
            expect(catalog.events.map((e) => e.name)).toEqual(['bounce', 'depth_scroll'])
            expect(writeStored).toHaveBeenCalledWith(['bounce', 'depth_scroll'])
          } else {
            expect(catalog.events.map((e) => e.name)).toEqual(
              conGuardado ? ['viejo_guardado'] : [],
            )
            expect(writeStored).not.toHaveBeenCalled()
          }
        })
      }
    }
  }

  it('no reescribe Firestore si lo deducido es igual a lo guardado', async () => {
    const writeStored = vi.fn(async () => {})
    await getEventCatalog(
      deps({
        namesFromCache: async () => ['bounce', 'depth_scroll'],
        readStored: async () => ['bounce', 'depth_scroll'],
        writeStored,
      }),
    )
    expect(writeStored).not.toHaveBeenCalled()
  })

  it('si la caché explota, cae a lo guardado en vez de quedar sin catálogo', async () => {
    const catalog = await getEventCatalog(
      deps({
        namesFromCache: async () => {
          throw new Error('DuckDB no está')
        },
        readStored: async () => ['bounce'],
      }),
    )
    expect(catalog.events.map((e) => e.name)).toEqual(['bounce'])
  })

  it('sin declaración, los eventos no tienen label propio ni grupo', async () => {
    const catalog = await getEventCatalog(deps({ namesFromCache: async () => ['bounce'] }))
    expect(catalog.events[0]).toEqual({ name: 'bounce', label: 'bounce', group: null, values: [] })
  })
})
