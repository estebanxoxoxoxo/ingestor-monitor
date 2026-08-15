import { describe, expect, it } from 'vitest'
import { buildSnapshot } from '../src/main/live/liveService'

const GEO = { city: 'Pozuelo de Alarcón', country: 'ES', region: 'MD', lat: 40.4345, lng: -3.8244 }
const GEO_SIN_COORDS = { city: 'localhost', country: 'DEV', region: 'DEV' }

/** Una entrada del nodo, con la forma real de la RTDB. */
const pestania = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
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

describe('buildSnapshot — un nodo, una fila', () => {
  it('cada pestaña es su propia fila aunque compartan identificadores', () => {
    const snapshot = buildSnapshot({
      t1: pestania({ session_id: 'S1', anonymous_id: 'A1' }),
      t2: pestania({ session_id: 'S1', anonymous_id: 'A1' }),
    })
    expect(snapshot.tabs).toHaveLength(2)
    expect(snapshot.tabs.map((t) => t.id).sort()).toEqual(['t1', 't2'])
  })

  it('el id es la clave del nodo, siempre: un solo significado', () => {
    const snapshot = buildSnapshot({ t1: pestania({ session_id: 'S1', anonymous_id: 'A1' }) })
    expect(snapshot.tabs[0].id).toBe('t1')
    expect(snapshot.tabs[0].sessionId).toBe('S1')
    expect(snapshot.tabs[0].anonymousId).toBe('A1')
  })

  it('ordena de la escritura más nueva a la más vieja', () => {
    const snapshot = buildSnapshot({
      vieja: pestania({ last_seen: '2026-08-05T20:00:00.000Z' }),
      nueva: pestania({ last_seen: '2026-08-05T21:00:00.000Z' }),
    })
    expect(snapshot.tabs.map((t) => t.id)).toEqual(['nueva', 'vieja'])
  })

  it('cuenta sus propios eventos, sin sumar los de nadie', () => {
    const snapshot = buildSnapshot({
      t1: pestania({
        events: {
          a: evento('cta_click', '2026-08-05T20:00:00.000Z'),
          b: evento('depth_scroll', '2026-08-05T20:01:00.000Z'),
        },
      }),
      t2: pestania({ events: { c: evento('cta_click', '2026-08-05T20:02:00.000Z') } }),
    })
    const porId = new Map(snapshot.tabs.map((tab) => [tab.id, tab]))
    expect(porId.get('t1')?.eventCount).toBe(2)
    expect(porId.get('t1')?.eventsByName).toEqual({ cta_click: 1, depth_scroll: 1 })
    expect(porId.get('t2')?.eventCount).toBe(1)
    expect(snapshot.totalEvents).toBe(3)
  })

  it('la geo es la suya: sin coordenadas no va al mapa', () => {
    const snapshot = buildSnapshot({
      t1: pestania({ geo: GEO }),
      t2: pestania({ geo: GEO_SIN_COORDS }),
    })
    expect(snapshot.tabs.map((t) => t.located).sort()).toEqual([false, true])
  })

  it('deja el evento apuntando a su pestaña, para poder pedir el crudo', () => {
    const snapshot = buildSnapshot({
      t1: pestania({ events: { e1: evento('cta_click', '2026-08-05T20:00:00.000Z') } }),
    })
    expect(snapshot.tabs[0].events[0].tabId).toBe('t1')
  })
})

describe('buildSnapshot — personas: un número, no una entidad', () => {
  it('dos pestañas del mismo navegador son una persona', () => {
    const snapshot = buildSnapshot({
      t1: pestania({ anonymous_id: 'A1' }),
      t2: pestania({ anonymous_id: 'A1' }),
    })
    expect(snapshot.tabs).toHaveLength(2)
    expect(snapshot.people).toBe(1)
  })

  it('navegadores distintos son personas distintas', () => {
    const snapshot = buildSnapshot({
      t1: pestania({ anonymous_id: 'A1' }),
      t2: pestania({ anonymous_id: 'A2' }),
    })
    expect(snapshot.people).toBe(2)
  })

  it('sin anonymous_id cada pestaña cuenta sola: no se puede afirmar que sea la misma', () => {
    const snapshot = buildSnapshot({ t1: pestania(), t2: pestania() })
    expect(snapshot.people).toBe(2)
  })

  it('mezcla: dos de una persona, una sin identificar', () => {
    const snapshot = buildSnapshot({
      t1: pestania({ anonymous_id: 'A1' }),
      t2: pestania({ anonymous_id: 'A1' }),
      t3: pestania(),
    })
    expect(snapshot.tabs).toHaveLength(3)
    expect(snapshot.people).toBe(2)
  })
})

describe('buildSnapshot — atención: quién está mirando', () => {
  it('cuenta las pestañas al frente', () => {
    const snapshot = buildSnapshot({
      t1: pestania({ visible: true }),
      t2: pestania({ visible: false }),
      t3: pestania({ visible: true }),
    })
    expect(snapshot.watching).toBe(2)
  })

  it('sin el campo se asume al frente: es como estaba antes de que existiera', () => {
    const snapshot = buildSnapshot({ t1: pestania() })
    expect(snapshot.tabs[0].visible).toBe(true)
    expect(snapshot.watching).toBe(1)
  })

  it('todas de fondo: nadie mirando', () => {
    const snapshot = buildSnapshot({
      t1: pestania({ visible: false }),
      t2: pestania({ visible: false }),
    })
    expect(snapshot.watching).toBe(0)
  })
})

describe('buildSnapshot — bordes', () => {
  it('un nodo vacío no rompe', () => {
    const snapshot = buildSnapshot(null)
    expect(snapshot.tabs).toHaveLength(0)
    expect(snapshot.people).toBe(0)
    expect(snapshot.watching).toBe(0)
    expect(snapshot.totalEvents).toBe(0)
  })

  it('lat/lng como string se parsean igual', () => {
    const snapshot = buildSnapshot({
      t1: pestania({ geo: { ...GEO, lat: '40.4345', lng: '-3.8244' } }),
    })
    expect(snapshot.tabs[0].geo.lat).toBe(40.4345)
    expect(snapshot.tabs[0].located).toBe(true)
  })

  it('los totales por evento se ordenan de mayor a menor', () => {
    const snapshot = buildSnapshot({
      t1: pestania({
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
      t1: pestania({
        events: {
          e1: {
            event: 'reading_scroll',
            options: { originalTimestamp: '2026-08-06T21:45:01.000Z' },
            properties: { event_id: 'x', suite: { engaged_time_sec: 22.1 }, values },
          },
        },
      }),
    })
    return snapshot.tabs[0].events[0].values
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
    ['forma nueva con string', [{ direction: 'up' }], [{ name: 'direction', value: 'up' }]],
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
