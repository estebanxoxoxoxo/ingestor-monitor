import { describe, expect, it } from 'vitest'
import { buildSnapshot } from '../src/main/live/liveService'

const GEO = { city: 'Pozuelo de Alarcón', country: 'ES', region: 'MD', lat: 40.4345, lng: -3.8244 }
const GEO_SIN_COORDS = { city: 'localhost', country: 'DEV', region: 'DEV' }

/** Una entrada del nodo, con la forma real de la RTDB. */
const conexion = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  engaged_time_sec: 10,
  geo: GEO,
  last_seen: '2026-08-05T21:15:31.553Z',
  started_at: '2026-08-05T20:53:54.443Z',
  page: '/',
  ...over,
})

const evento = (name: string, at: string): Record<string, unknown> => ({
  event: name,
  options: { originalTimestamp: at },
  properties: { event_id: `${name}-${at}`, suite: { engaged_time_sec: 5 }, values: [] },
})

describe('buildSnapshot — todas las combinaciones de identificadores', () => {
  /*
   * Cuatro ejes binarios cruzados: session_id, anonymous_id, una o dos
   * conexiones, y geo con o sin coordenadas. Son 16 casos y se afirman todos,
   * porque la regla de agrupamiento es justo donde un cambio se cuela sin que
   * nadie lo note.
   */
  const ejes = [false, true]
  for (const conSession of ejes) {
    for (const conAnon of ejes) {
      for (const dosConexiones of ejes) {
        for (const conCoords of ejes) {
          const titulo =
            `session_id=${conSession ? 'sí' : 'no'} ` +
            `anonymous_id=${conAnon ? 'sí' : 'no'} ` +
            `conexiones=${dosConexiones ? 2 : 1} ` +
            `coords=${conCoords ? 'sí' : 'no'}`

          it(titulo, () => {
            const base = {
              ...(conSession ? { session_id: 'S1' } : {}),
              ...(conAnon ? { anonymous_id: 'A1' } : {}),
              geo: conCoords ? GEO : GEO_SIN_COORDS,
            }
            const node: Record<string, unknown> = { c1: conexion(base) }
            if (dosConexiones) node.c2 = conexion(base)

            const snapshot = buildSnapshot(node)

            expect(snapshot.connections).toBe(dosConexiones ? 2 : 1)

            // Dos pestañas colapsan en una sesión sólo si hay con qué unirlas.
            const compartenIdentificador = conSession || conAnon
            const sesionesEsperadas = dosConexiones && !compartenIdentificador ? 2 : 1
            expect(snapshot.sessions).toHaveLength(sesionesEsperadas)

            const esperado = conSession ? 'session_id' : conAnon ? 'anonymous_id' : 'connection'
            expect(snapshot.sessions[0].groupedBy).toBe(esperado)
            expect(snapshot.sessions[0].id).toBe(conSession ? 'S1' : conAnon ? 'A1' : 'c1')

            expect(snapshot.sessions.every((s) => s.located === conCoords)).toBe(true)
          })
        }
      }
    }
  }
})

describe('buildSnapshot — agregados de una sesión con dos pestañas', () => {
  const node = {
    c1: conexion({
      session_id: 'S1',
      engaged_time_sec: 600,
      started_at: '2026-08-05T20:00:00.000Z',
      last_seen: '2026-08-05T21:00:00.000Z',
      events: { e1: evento('depth_scroll', '2026-08-05T20:30:00.000Z') },
    }),
    c2: conexion({
      session_id: 'S1',
      engaged_time_sec: 120,
      started_at: '2026-08-05T20:30:00.000Z',
      last_seen: '2026-08-05T21:10:00.000Z',
      geo: GEO_SIN_COORDS,
      events: {
        e2: evento('depth_scroll', '2026-08-05T20:40:00.000Z'),
        e3: evento('cta_click', '2026-08-05T20:50:00.000Z'),
      },
    }),
  }
  const [session] = buildSnapshot(node).sessions

  it('suma los eventos de las dos pestañas', () => {
    expect(session.eventCount).toBe(3)
    expect(session.eventsByName).toEqual({ depth_scroll: 2, cta_click: 1 })
  })

  it('toma el mayor tiempo comprometido, no la suma', () => {
    // Dos pestañas abiertas no significan el doble de tiempo de la persona.
    expect(session.engagedTimeSec).toBe(600)
  })

  it('toma el inicio más viejo y la última señal más nueva', () => {
    expect(session.startedAt).toBe('2026-08-05T20:00:00.000Z')
    expect(session.lastSeen).toBe('2026-08-05T21:10:00.000Z')
  })

  it('usa la geo de la pestaña que tenga coordenadas', () => {
    expect(session.located).toBe(true)
    expect(session.geo.city).toBe('Pozuelo de Alarcón')
  })

  it('deja el evento apuntando a su conexión, para poder pedir el crudo', () => {
    const ids = session.connections.flatMap((c) => c.events.map((e) => e.connectionId))
    expect(new Set(ids)).toEqual(new Set(['c1', 'c2']))
  })
})

describe('buildSnapshot — bordes', () => {
  it('un nodo vacío no rompe', () => {
    const snapshot = buildSnapshot(null)
    expect(snapshot.sessions).toHaveLength(0)
    expect(snapshot.connections).toBe(0)
    expect(snapshot.totalEvents).toBe(0)
  })

  it('lat/lng como string se parsean igual', () => {
    const snapshot = buildSnapshot({
      c1: conexion({ geo: { ...GEO, lat: '40.4345', lng: '-3.8244' } }),
    })
    expect(snapshot.sessions[0].geo.lat).toBe(40.4345)
    expect(snapshot.sessions[0].located).toBe(true)
  })

  it('los totales por evento se ordenan de mayor a menor', () => {
    const snapshot = buildSnapshot({
      c1: conexion({
        session_id: 'S1',
        events: {
          a: evento('cta_click', '2026-08-05T20:00:00.000Z'),
          b: evento('depth_scroll', '2026-08-05T20:01:00.000Z'),
          c: evento('depth_scroll', '2026-08-05T20:02:00.000Z'),
        },
      }),
    })
    expect(snapshot.eventTotals).toEqual([
      { name: 'depth_scroll', count: 2 },
      { name: 'cta_click', count: 1 },
    ])
  })
})

describe('parseo de values — conviven la convención vieja y la del SDK 2026-08-06', () => {
  const valoresDe = (values: unknown[]): { name: string; value: number | string }[] => {
    const snapshot = buildSnapshot({
      c1: conexion({
        session_id: 'S1',
        events: {
          e1: {
            event: 'reading_scroll',
            options: { originalTimestamp: '2026-08-06T21:45:01.000Z' },
            properties: { event_id: 'x', suite: { engaged_time_sec: 22.1 }, values },
          },
        },
      }),
    })
    return snapshot.sessions[0].connections[0].events[0].values
  }

  it.each([
    // [caso, entradas del nodo, valores parseados]
    [
      'forma vieja {name, value}',
      [{ name: 'gestures', value: 123 }],
      [{ name: 'gestures', value: 123 }],
    ],
    [
      'forma nueva {nombre: valor}, una medición por entrada',
      [{ quantity: 3 }, { span_seconds: 2.168 }],
      [
        { name: 'quantity', value: 3 },
        { name: 'span_seconds', value: 2.168 },
      ],
    ],
    [
      'forma nueva con array: se serializa en vez de perderse',
      [{ gestures: [246, 23, 23] }],
      [{ name: 'gestures', value: '[246,23,23]' }],
    ],
    [
      'forma nueva con string',
      [{ direction: 'up' }],
      [{ name: 'direction', value: 'up' }],
    ],
    [
      'las dos formas mezcladas en el mismo evento',
      [{ name: 'clicks', value: 7 }, { delta_px: 2902.4 }],
      [
        { name: 'clicks', value: 7 },
        { name: 'delta_px', value: 2902.4 },
      ],
    ],
    ['entrada vacía no aporta nada', [{}], []],
    ['forma vieja sin valor escalar ni serializable se descarta', [{ name: 'x' }], []],
  ])('%s', (_caso, values, esperado) => {
    expect(valoresDe(values as unknown[])).toEqual(esperado)
  })
})
