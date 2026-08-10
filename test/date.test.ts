import { describe, expect, it } from 'vitest'
import { eachDay, maxDate, toIsoDate } from '../src/shared/date'

describe('eachDay — la ventana del sync', () => {
  it.each([
    ['un solo día', '2026-08-05', '2026-08-05', ['2026-08-05']],
    ['dos días', '2026-08-04', '2026-08-05', ['2026-08-04', '2026-08-05']],
    ['cruza fin de mes', '2026-07-31', '2026-08-01', ['2026-07-31', '2026-08-01']],
    ['cruza año', '2025-12-31', '2026-01-01', ['2025-12-31', '2026-01-01']],
    ['año bisiesto', '2028-02-28', '2028-03-01', ['2028-02-28', '2028-02-29', '2028-03-01']],
    ['from posterior a to', '2026-08-06', '2026-08-05', []],
  ])('%s', (_caso, from, to, esperado) => {
    expect(eachDay(from, to)).toEqual(esperado)
  })

  it('no se saltea días en un cambio de horario de verano', () => {
    // La aritmética es en UTC, así que el DST no existe. Si alguien la pasara a
    // hora local, marzo y octubre perderían o duplicarían un día y esto avisa.
    expect(eachDay('2026-03-28', '2026-03-31')).toEqual([
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
      '2026-03-31',
    ])
    expect(eachDay('2026-10-24', '2026-10-27')).toHaveLength(4)
  })

  it('un mes entero da exactamente sus días', () => {
    expect(eachDay('2026-01-01', '2026-01-31')).toHaveLength(31)
  })
})

describe('maxDate y toIsoDate', () => {
  it('compara fechas ISO como strings', () => {
    expect(maxDate('2026-08-05', '2026-08-04')).toBe('2026-08-05')
    expect(maxDate('2026-08-04', '2026-08-05')).toBe('2026-08-05')
    expect(maxDate('2026-08-05', '2026-08-05')).toBe('2026-08-05')
  })

  it('toma el día UTC y no el local', () => {
    // 23:30 en Buenos Aires del día 5 es el día 6 en UTC.
    expect(toIsoDate(new Date('2026-08-06T02:30:00.000Z'))).toBe('2026-08-06')
    expect(toIsoDate(new Date('2026-08-05T23:59:59.999Z'))).toBe('2026-08-05')
  })
})
