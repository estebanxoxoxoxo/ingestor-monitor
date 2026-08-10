import { useCallback, useEffect, useState } from 'react'

export interface UseRelevantEvents {
  relevant: string[]
  /** Todavía no llegó la respuesta de Firestore. */
  loading: boolean
  error: string | null
  save: (names: string[]) => Promise<void>
}

/**
 * Qué eventos van a la línea de relevantes y en qué orden.
 *
 * Se guarda en Firestore, no en la máquina: es una decisión de quien analiza y
 * tiene que aparecer igual al abrir la app en otra computadora.
 */
export function useRelevantEvents(): UseRelevantEvents {
  const [relevant, setRelevant] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.getSettings().then((settings) => {
      setRelevant(settings.relevantEvents)
      setError(settings.error ?? null)
      setLoading(false)
    })
  }, [])

  const save = useCallback(async (names: string[]): Promise<void> => {
    // Se muestra al toque y se corrige si la escritura falla: la elección ya
    // está tomada, no tiene sentido esperar a la red para reflejarla.
    const previous = relevant
    setRelevant(names)
    const result = await window.api.saveSettings({ relevantEvents: names })
    if (result.ok) {
      setError(null)
      return
    }
    setRelevant(previous)
    setError(result.error ?? 'No se pudo guardar la elección.')
  }, [relevant])

  return { relevant, loading, error, save }
}
