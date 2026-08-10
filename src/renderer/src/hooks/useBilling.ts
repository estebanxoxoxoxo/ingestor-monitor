import { useCallback, useEffect, useState } from 'react'
import type { BillingSummary } from '@shared/types'

/**
 * La facturación del mes. Main la consultó UNA vez al abrir la app; este
 * hook lee ese caché (gratis). El botón fuerza una consulta real (US$ 0,01).
 */
export function useBilling() {
  const [summary, setSummary] = useState<BillingSummary | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (refresh: boolean): Promise<void> => {
    setLoading(true)
    try {
      setSummary(await window.api.getBilling(refresh))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
  }, [load])

  return { summary, loading, refresh: (): void => void load(true) }
}
