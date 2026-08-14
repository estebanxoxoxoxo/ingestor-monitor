import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  onDayChange,
  start,
  stop,
  currentDay,
} from '../src/main/ingestor-monitor/todayFSM/todayFSM'
import type { DayRollover } from '../src/main/ingestor-monitor/todayFSM/todayFSM'

/**
 * La máquina del día UTC: la única que mira el reloj. Acá el reloj se mueve
 * a mano — sin esperar a ninguna medianoche de verdad.
 */

const at = (iso: string): void => {
  vi.setSystemTime(new Date(iso))
}

afterEach(() => {
  stop()
  vi.useRealTimers()
})

/** Arranca la máquina en un instante dado y devuelve los rollovers que emita. */
function machineFrom(iso: string): DayRollover[] {
  vi.useFakeTimers()
  at(iso)
  start()
  const rollovers: DayRollover[] = []
  onDayChange((rollover) => rollovers.push(rollover))
  return rollovers
}

describe('la máquina del día UTC', () => {
  it('el día es el UTC, no el de la máquina', () => {
    // 23:30 en Argentina (UTC-3) del 13 ya es día 14 en Greenwich.
    machineFrom('2026-08-14T02:30:00Z')
    expect(currentDay()).toBe('2026-08-14')
  })

  it('dentro del mismo día no avisa nada', () => {
    const rollovers = machineFrom('2026-08-14T00:00:00Z')
    at('2026-08-14T23:59:59Z')
    expect(currentDay()).toBe('2026-08-14')
    expect(rollovers).toEqual([])
  })

  it('al cruzar la medianoche avisa UNA vez, con el día que cierra y el que abre', () => {
    const rollovers = machineFrom('2026-08-14T23:59:00Z')
    at('2026-08-15T00:00:01Z')
    expect(currentDay()).toBe('2026-08-15')
    expect(rollovers).toEqual([{ from: '2026-08-14', to: '2026-08-15' }])
  })

  it('preguntar de nuevo no vuelve a avisar', () => {
    const rollovers = machineFrom('2026-08-14T23:59:00Z')
    at('2026-08-15T00:00:01Z')
    currentDay()
    currentDay()
    currentDay()
    expect(rollovers).toHaveLength(1)
  })

  it('quien pregunta EN medio del aviso ya ve el día nuevo: no hay recursión', () => {
    vi.useFakeTimers()
    at('2026-08-14T23:59:00Z')
    start()
    const seen: string[] = []
    onDayChange(() => seen.push(currentDay()))
    at('2026-08-15T00:00:01Z')
    currentDay()
    expect(seen).toEqual(['2026-08-15'])
  })

  it('con la app dormida varios días, avisa una sola transición: del viejo al de currentDay', () => {
    const rollovers = machineFrom('2026-08-14T10:00:00Z')
    at('2026-08-20T10:00:00Z')
    expect(currentDay()).toBe('2026-08-20')
    expect(rollovers).toEqual([{ from: '2026-08-14', to: '2026-08-20' }])
  })

  it('el chequeo por minuto avisa sin que nadie pregunte', () => {
    const rollovers = machineFrom('2026-08-14T23:59:30Z')
    at('2026-08-15T00:00:30Z')
    vi.advanceTimersByTime(60_000)
    expect(rollovers).toEqual([{ from: '2026-08-14', to: '2026-08-15' }])
  })
})
