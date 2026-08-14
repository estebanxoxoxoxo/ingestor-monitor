import { useCallback, useEffect, useState } from 'react'
import type { LayerId } from '@shared/config'
import type { RegenerateTreeSnapshot } from '@shared/types'

/**
 * La regeneración del árbol en la base. Pedirla es dejar una orden: el
 * trabajo lo hace Google y su progreso llega solo, por suscripción — así
 * que la app puede cerrarse en el medio y al volver sigue viéndolo.
 */
export function useRegenerateTree() {
  const [snapshot, setSnapshot] = useState<RegenerateTreeSnapshot | null>(null)

  useEffect(() => window.api.subscribeRegenerateTree(setSnapshot), [])

  const request = useCallback((layer: LayerId): void => {
    void window.api.regenerateTreeInDb(layer)
  }, [])

  return { snapshot, request }
}
