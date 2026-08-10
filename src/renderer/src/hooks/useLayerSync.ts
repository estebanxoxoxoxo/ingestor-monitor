import { useCallback, useEffect, useState } from 'react'
import type { LayerId } from '@shared/config'
import type { LayerState, SyncProgress, SyncResult } from '@shared/types'

/** Estado, progreso y disparo de la sync de UNA capa. */
export function useLayerSync(layer: LayerId) {
  const [state, setState] = useState<LayerState | null>(null)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [result, setResult] = useState<SyncResult | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    setState(await window.api.getLayerState(layer))
  }, [layer])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // El canal de progreso trae todas las capas: acá se filtra la propia.
  useEffect(
    () =>
      window.api.onLayerSyncProgress((update) => {
        if (update.layer === layer) setProgress(update)
      }),
    [layer],
  )

  const sync = useCallback(async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    try {
      setResult(await window.api.runLayerSync(layer))
      await refresh()
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }, [layer, refresh])

  return { state, progress, result, busy, sync }
}
