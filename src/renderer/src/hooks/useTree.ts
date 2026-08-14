import { useEffect, useState } from 'react'
import type { TreeSnapshot } from '@shared/types'

/**
 * El árbol de las dos capas, ya mergeado en main (hoy vivo + historia).
 * UNA sola suscripción por ventana: vive en App y baja por props — de acá
 * salen las tablas, los contadores del header y los puntos de frescura.
 */
export function useTree(): TreeSnapshot | null {
  const [snapshot, setSnapshot] = useState<TreeSnapshot | null>(null)

  useEffect(() => window.api.subscribeTree(setSnapshot), [])

  return snapshot
}
