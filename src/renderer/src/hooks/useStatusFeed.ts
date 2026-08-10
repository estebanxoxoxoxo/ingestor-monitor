import { useEffect, useState } from 'react'
import type { StatusSnapshot } from '@shared/types'

/** El feed del pipeline, por suscripción. Se corta al desmontar la pestaña. */
export function useStatusFeed(active: boolean): StatusSnapshot | null {
  const [snapshot, setSnapshot] = useState<StatusSnapshot | null>(null)

  useEffect(() => {
    if (!active) return
    return window.api.subscribeStatus(setSnapshot)
  }, [active])

  return snapshot
}
