import { describe, expect, it } from 'vitest'
import { classify } from '../src/main/ingest-monitor/layerFreshness'

/**
 * La regla de la casa: los cortes van por DÍA UTC de calendario, nunca por
 * ventanas móviles de 24 h. La función es pura (recibe el reloj), así que
 * cada borde se afirma sin depender de la hora de la máquina.
 */
describe('classify — frescura por día UTC de calendario', () => {
  const mediodia = Date.parse('2026-08-10T12:00:00Z')

  it.each([
    // [caso, lastDataAt, now, estado esperado]
    ['nunca recibió nada', null, mediodia, 'red'],
    ['data de hoy a la madrugada (hace ~12 h, MISMO día)', '2026-08-10T00:05:00.000Z', mediodia, 'green'],
    ['data de hoy recién', '2026-08-10T11:59:00.000Z', mediodia, 'green'],
    ['data de ayer a la noche: ayer es ayer', '2026-08-09T23:59:00.000Z', mediodia, 'orange'],
    // El caso filoso: pasaron SEIS MINUTOS pero cambió el día UTC.
    [
      'ayer 23:59 mirado hoy 00:05',
      '2026-08-09T23:59:00.000Z',
      Date.parse('2026-08-10T00:05:00Z'),
      'orange',
    ],
    ['hace 6 días: todavía naranja', '2026-08-04T12:00:00.000Z', mediodia, 'orange'],
    ['hace exactamente una semana: violeta', '2026-08-03T12:00:00.000Z', mediodia, 'violet'],
    ['hace un mes', '2026-07-10T12:00:00.000Z', mediodia, 'violet'],
  ])('%s → %s', (_caso, lastDataAt, now, esperado) => {
    expect(classify(lastDataAt as string | null, now as number)).toBe(esperado)
  })
})
