import { useCallback, useEffect, useState } from 'react'
import type { LayerId } from '@shared/config'
import type { LayerState } from '@shared/types'

/**
 * El índice de una capa: lo que el vigía listó del bucket, en memoria de
 * main. Se lee al montar y se re-lee por minuto (lectura local, sin costo);
 * el botón de sync fuerza un listado real ya mismo.
 */
export function useLayerIndex(layer: LayerId) {
  const [state, setState] = useState<LayerState | null>(null)
  const [busy, setBusy] = useState(false)

  const read = useCallback(async (): Promise<void> => {
    setState(await window.api.getLayerState(layer))
  }, [layer])

  useEffect(() => {
    void read()
    // Sigue el ritmo del vigía sin pedir nada a S3: main ya tiene la foto.
    const timer = setInterval(() => {
      void read()
    }, 60_000)
    return () => clearInterval(timer)
  }, [read])

  const relist = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      setState(await window.api.relistLayer(layer))
    } finally {
      setBusy(false)
    }
  }, [layer])

  return { state, busy, relist }
}
