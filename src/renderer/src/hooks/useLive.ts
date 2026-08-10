import { useEffect, useState } from 'react'
import type { LiveSnapshot } from '@shared/types'

/**
 * Espejo del nodo /activeSessions. El main mantiene el listener de la RTDB y
 * empuja fotos ya normalizadas; acá sólo se guardan.
 */
export function useLive(active: boolean): LiveSnapshot | null {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null)

  useEffect(() => {
    if (!active) return
    return window.api.subscribeLive(setSnapshot)
  }, [active])

  return snapshot
}

/** Reloj para que los "hace 12s" se refresquen aunque no llegue data nueva. */
export function useTicker(active: boolean, everyMs = 1000): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setTick((t) => t + 1), everyMs)
    return () => clearInterval(id)
  }, [active, everyMs])
  return tick
}
