import { useEffect, useState } from 'react'
import type { IngestStatus } from '@shared/types'

/**
 * El semáforo del ingestor. UNA sola suscripción por ventana (vive en App):
 * el estado baja por props a la pestaña y al detalle de Status — dos
 * suscripciones desde la misma ventana se pisarían en main.
 */
export function useIngestStatus(): IngestStatus | null {
  const [status, setStatus] = useState<IngestStatus | null>(null)

  useEffect(() => window.api.subscribeIngest(setStatus), [])

  return status
}
