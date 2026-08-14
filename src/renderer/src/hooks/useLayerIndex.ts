import { useCallback, useEffect, useState } from 'react'
import type { LayerId } from '@shared/config'
import type { LayerState } from '@shared/types'

/**
 * El índice de una capa: lo que el vigía listó del bucket, en memoria de
 * main. Se lee al montar y se re-lee por minuto (lectura local, sin costo).
 * El Full sync vive en la pestaña Config; al volver acá, la foto reparada
 * ya se lee sola.
 */
export function useLayerIndex(layer: LayerId) {
  const [state, setState] = useState<LayerState | null>(null)

  const read = useCallback(async (): Promise<void> => {
    setState(await window.api.getLayerState(layer))
  }, [layer])

  useEffect(() => {
    void read()
    // Sigue el ritmo del vigía sin pedir nada afuera: main ya tiene la foto.
    const timer = setInterval(() => {
      void read()
    }, 60_000)
    return () => clearInterval(timer)
  }, [read])

  return { state }
}
