import { useCallback, useEffect, useState } from 'react'
import type { FirebaseUsage } from '@shared/types'

/**
 * El uso de Firebase (Firestore + RTDB). Main lo consultó UNA vez al abrir
 * la app; este hook lee ese caché. El botón fuerza una consulta real
 * (gratis a este volumen: Cloud Monitoring).
 */
export function useFirebaseUsage() {
  const [usage, setUsage] = useState<FirebaseUsage | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (refresh: boolean): Promise<void> => {
    setLoading(true)
    try {
      setUsage(await window.api.getFirebaseUsage(refresh))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
  }, [load])

  return { usage, loading, refresh: (): void => void load(true) }
}
