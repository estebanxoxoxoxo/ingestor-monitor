import { useCallback, useEffect, useState } from 'react'
import type { EventDefinition, EventGroup } from '@shared/types'

export interface UseEventCatalog {
  events: EventDefinition[]
  groups: EventGroup[]
  /** true si sale del archivo declarado; false si se dedujo de los datos. */
  declared: boolean
  reload: () => Promise<void>
}

/** Los eventos que existen, según el registro. */
export function useEventCatalog(): UseEventCatalog {
  const [events, setEvents] = useState<EventDefinition[]>([])
  const [groups, setGroups] = useState<EventGroup[]>([])
  const [declared, setDeclared] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    const catalog = await window.api.getEventCatalog()
    setEvents(catalog.events)
    setGroups(catalog.groups)
    setDeclared(catalog.declared)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { events, groups, declared, reload }
}
