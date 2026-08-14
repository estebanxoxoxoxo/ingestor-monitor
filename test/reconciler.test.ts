import { describe, expect, it } from 'vitest'
import {
  freshnessOf,
  instantOf,
  mergeDays,
  sortNewest,
} from '../src/main/ingestor-monitor/data/reconciler/reconciler'
import type { LayerDay } from '@shared/types'

/**
 * Las reglas puras del reconciliador: cómo se mergean hoy y la historia,
 * cómo se traduce antigüedad a color y cómo se fechan los archivos. Sin
 * Firestore y sin reloj de la máquina — el día de hoy se pasa por parámetro.
 */

const HOY = '2026-08-14'
const day = (date: string, files: number, bytes: number): LayerDay => ({ date, files, bytes })

describe('mergeDays — cada día lo cuenta UNA fuente', () => {
  it('hoy en vivo va primero, la historia atrás', () => {
    const merged = mergeDays(
      [day('2026-08-13', 11, 1500), day('2026-08-12', 8, 900)],
      day(HOY, 3, 300),
    )
    expect(merged.map((d) => d.date)).toEqual([HOY, '2026-08-13', '2026-08-12'])
    expect(merged[0].files).toBe(3)
  })

  it('si la historia todavía trae hoy, manda el vivo: no se cuenta dos veces', () => {
    const merged = mergeDays([day(HOY, 99, 99_999), day('2026-08-13', 11, 1500)], day(HOY, 3, 300))
    expect(merged).toHaveLength(2)
    expect(merged[0]).toEqual(day(HOY, 3, 300))
  })

  it('un hoy sin ingesta no entra al árbol', () => {
    const merged = mergeDays([day('2026-08-13', 11, 1500)], day(HOY, 0, 0))
    expect(merged.map((d) => d.date)).toEqual(['2026-08-13'])
  })

  it('sin historia queda sólo hoy', () => {
    expect(mergeDays([], day(HOY, 3, 300))).toEqual([day(HOY, 3, 300)])
  })
})

describe('freshnessOf — antigüedad a color, en días UTC de calendario', () => {
  it('data de hoy es verde', () => {
    expect(freshnessOf(HOY, HOY)).toBe('green')
  })

  it('de ayer a 6 días es naranja — ayer es ayer aunque hayan pasado minutos', () => {
    expect(freshnessOf('2026-08-13', HOY)).toBe('orange')
    expect(freshnessOf('2026-08-08', HOY)).toBe('orange')
  })

  it('una semana o más es violeta', () => {
    expect(freshnessOf('2026-08-07', HOY)).toBe('violet')
    expect(freshnessOf('2025-01-01', HOY)).toBe('violet')
  })

  it('nunca entró nada es negra', () => {
    expect(freshnessOf(null, HOY)).toBe('black')
  })

  it('cruza meses y años sin equivocarse', () => {
    expect(freshnessOf('2026-07-31', '2026-08-01')).toBe('orange')
    expect(freshnessOf('2025-12-31', '2026-01-01')).toBe('orange')
    expect(freshnessOf('2026-07-26', '2026-08-01')).toBe('orange') // 6 días
    expect(freshnessOf('2026-07-25', '2026-08-01')).toBe('violet') // 7 días
  })
})

describe('instantOf — la época del nombre fecha el archivo', () => {
  it('el prefijo de diez dígitos es la hora del flush', () => {
    const file = { name: '1786365397-abc.ndjson.gz', size: 1, lastModified: null }
    expect(instantOf(file)).toBe(1_786_365_397_000)
  })

  it('sin época en el nombre, vale el LastModified', () => {
    const file = { name: 'sin-epoca.parquet', size: 1, lastModified: '2026-08-14T10:00:00Z' }
    expect(instantOf(file)).toBe(Date.parse('2026-08-14T10:00:00Z'))
  })

  it('sin nada, no se puede fechar', () => {
    expect(instantOf({ name: 'x.parquet', size: 1, lastModified: null })).toBe(0)
  })
})

describe('sortNewest — el log va del último al primero', () => {
  it('ordena por instante, sin tocar el array original', () => {
    const files = [
      { name: '1700000001-a.gz', size: 1, lastModified: null },
      { name: '1700000003-c.gz', size: 1, lastModified: null },
      { name: '1700000002-b.gz', size: 1, lastModified: null },
    ]
    const sorted = sortNewest(files)
    expect(sorted.map((f) => f.name)).toEqual([
      '1700000003-c.gz',
      '1700000002-b.gz',
      '1700000001-a.gz',
    ])
    expect(files[0].name).toBe('1700000001-a.gz')
  })
})
