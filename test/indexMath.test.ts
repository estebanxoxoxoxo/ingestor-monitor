import { describe, expect, it } from 'vitest'
import {
  baseName,
  daySummaryOf,
  diffByName,
  inRolloverGrace,
  instantOf,
  previousDay,
} from '../src/main/ingest-monitor/indexMath'
import type { RemoteObject } from '../src/main/lake'

/**
 * La aritmética del índice en Firestore: el diff que decide qué se escribe
 * (y qué NO), y el instante de cada archivo. Funciones puras: sin S3, sin
 * Firestore, sin reloj de la máquina.
 */

const obj = (key: string, size = 10, lastModified: string | null = null): RemoteObject => ({
  key,
  size,
  date: key.match(/dt=(\d{4}-\d{2}-\d{2})/)?.[1] ?? null,
  lastModified,
})

describe('previousDay — el día de la gracia post-medianoche', () => {
  it('resta un día', () => expect(previousDay('2026-08-10')).toBe('2026-08-09'))
  it('cruza el año', () => expect(previousDay('2026-01-01')).toBe('2025-12-31'))
})

describe('diffByName — a Firestore viaja SÓLO el diff', () => {
  const a = obj('raw/v=1/dt=2026-08-10/1754784000-aaaa.log.zst', 100)
  const b = obj('raw/v=1/dt=2026-08-10/1754784060-bbbb.log.zst', 200)

  it('archivo nuevo → added', () => {
    const { added, removed } = diffByName([a], [a, b])
    expect(added).toEqual([b])
    expect(removed).toEqual([])
  })
  it('archivo borrado de la consola → removed (el fantasma se cura)', () => {
    const { added, removed } = diffByName([a, b], [a])
    expect(added).toEqual([])
    expect(removed).toEqual([b])
  })
  it('sin novedades → nada: un minuto quieto no escribe', () => {
    const { added, removed } = diffByName([a, b], [a, b])
    expect(added).toEqual([])
    expect(removed).toEqual([])
  })
  it('mismo nombre con otro tamaño → se re-escribe', () => {
    const grown = { ...a, size: 999 }
    const { added, removed } = diffByName([a], [grown])
    expect(added).toEqual([grown])
    expect(removed).toEqual([])
  })
})

describe('daySummaryOf / instantOf — lo que el LIST trae gratis', () => {
  it('newestTs sale de la época del nombre (hora del flush de Vector)', () => {
    const summary = daySummaryOf([
      obj('raw/v=1/dt=2026-08-10/1754784000-aaaa.log.zst', 100),
      obj('raw/v=1/dt=2026-08-10/1754784060-bbbb.log.zst', 50),
    ])
    expect(summary.files).toBe(2)
    expect(summary.bytes).toBe(150)
    expect(summary.newestTs).toBe(new Date(1754784060 * 1000).toISOString())
  })
  it('sin época en el nombre cae a LastModified', () => {
    const o = obj('bronze/v=1/dt=2026-08-10/sin-epoca.parquet', 1, '2026-08-10T12:00:00.000Z')
    expect(instantOf(o)).toBe(Date.parse('2026-08-10T12:00:00.000Z'))
  })
  it('día vacío: newestTs null', () => {
    expect(daySummaryOf([]).newestTs).toBeNull()
  })
})

describe('inRolloverGrace — los flushes tardíos de Vector', () => {
  const grace = 10 * 60_000
  it('00:05 UTC: adentro, también se reconcilia ayer', () => {
    expect(inRolloverGrace(new Date('2026-08-10T00:05:00Z'), grace)).toBe(true)
  })
  it('00:15 UTC: afuera', () => {
    expect(inRolloverGrace(new Date('2026-08-10T00:15:00Z'), grace)).toBe(false)
  })
  it('mediodía: afuera', () => {
    expect(inRolloverGrace(new Date('2026-08-10T12:00:00Z'), grace)).toBe(false)
  })
})

describe('baseName', () => {
  it('el último segmento de la key: el id del doc en Firestore', () => {
    expect(baseName('raw/v=1/dt=2026-08-10/1754784000-aaaa.log.zst')).toBe(
      '1754784000-aaaa.log.zst',
    )
  })
})
