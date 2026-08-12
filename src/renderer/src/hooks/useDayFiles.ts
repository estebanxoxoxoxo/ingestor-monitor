import { useEffect, useState } from 'react'
import type { LayerId } from '@shared/config'
import type { DayFiles } from '@shared/types'

/**
 * Los archivos de un día, del índice (Firestore/vigía) — metadata, no data.
 * Se re-lee por minuto: para HOY refleja lo que el vigía va descubriendo;
 * para días viejos main responde de su cache, sin costo.
 */
export function useDayFiles(layer: LayerId, day: string) {
  const [data, setData] = useState<DayFiles | null>(null)

  useEffect(() => {
    let alive = true
    const read = async (): Promise<void> => {
      const files = await window.api.getDayFiles(layer, day)
      if (alive) setData(files)
    }
    setData(null)
    void read()
    const timer = setInterval(() => void read(), 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [layer, day])

  return data
}
