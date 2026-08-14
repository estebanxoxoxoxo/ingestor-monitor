import { useEffect, useState } from 'react'
import type { LayerId } from '@shared/config'
import type { FileSample } from '@shared/types'

/**
 * El contenido de UN archivo, pedido al lake al abrir el viewer. Volátil: vive
 * en el estado del componente y muere con él. Un archivo ya escrito no
 * cambia, así que no hay nada que refrescar.
 */
export function useFileSample(layer: LayerId, day: string, file: string) {
  const [sample, setSample] = useState<FileSample | null>(null)

  useEffect(() => {
    let alive = true
    setSample(null)
    void window.api.getFileSample({ layer, day, file }).then((result) => {
      if (alive) setSample(result)
    })
    return () => {
      alive = false
    }
  }, [layer, day, file])

  return sample
}
