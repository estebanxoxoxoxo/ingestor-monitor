import { useEffect, useState } from 'react'
import type { FreshnessSnapshot } from '@shared/types'

/**
 * La frescura de cada capa contra la caché local. UNA sola suscripción por
 * ventana (vive en App) y baja por props: los puntos van en las pestañas.
 */
export function useLayerFreshness(): FreshnessSnapshot | null {
  const [snapshot, setSnapshot] = useState<FreshnessSnapshot | null>(null)

  useEffect(() => window.api.subscribeFreshness(setSnapshot), [])

  return snapshot
}
