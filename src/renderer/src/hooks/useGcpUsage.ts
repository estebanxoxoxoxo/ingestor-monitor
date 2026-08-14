import { useCallback, useEffect, useState } from 'react'
import type { GcpUsage } from '@shared/types'

/**
 * El uso de Google Cloud (GCS, VM, función, Pub/Sub, Artifact Registry).
 * Main lo consultó UNA vez al abrir la app; este hook lee ese caché. El
 * botón fuerza una consulta real (gratis a este volumen: Cloud Monitoring).
 */
export function useGcpUsage() {
  const [usage, setUsage] = useState<GcpUsage | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (refresh: boolean): Promise<void> => {
    setLoading(true)
    try {
      setUsage(await window.api.getGcpUsage(refresh))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
  }, [load])

  return { usage, loading, refresh: (): void => void load(true) }
}
