import { useEffect, useState } from 'react'
import type { EventDefinition, EventGroup } from '@shared/types'
import { formatUtcTime } from '../../lib/format'
import { useLive, useTicker } from '../../hooks/useLive'
import { LiveHeader } from './LiveHeader'
import { TabDetail } from './TabDetail'
import { TabList } from './TabList'
import { WorldMap } from './WorldMap'

interface Props {
  active: boolean
  catalog: EventDefinition[]
  groups: EventGroup[]
  declared: boolean
}

export function LiveView({ active, catalog, groups, declared }: Props) {
  const snapshot = useLive(active)
  // El reloj de la vista: sin él, "abierta hace 12s" se quedaría clavado
  // hasta que llegara data. Con él sube de a un segundo.
  useTicker(active)

  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const tabs = snapshot?.tabs ?? []
  const selected = tabs.find((tab) => tab.id === selectedId) ?? null

  // Si la pestaña abierta se cierra del otro lado, se vuelve a la lista sola.
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null)
  }, [selectedId, selected])

  return (
    <div className="live-view">
      <LiveHeader snapshot={snapshot} catalog={catalog} groups={groups} declared={declared} />

      <div className="live-body">
        <WorldMap
          tabs={tabs}
          hoveredId={hoveredId}
          selectedId={selectedId}
          onHover={setHoveredId}
          onSelect={setSelectedId}
        />

        <aside className="live-side">
          {selected ? (
            <TabDetail tab={selected} onBack={() => setSelectedId(null)} />
          ) : (
            <>
              <header className="side-header">
                <h2>Pestañas</h2>
                <span>{tabs.length}</span>
              </header>
              <TabList
                tabs={tabs}
                hoveredId={hoveredId}
                selectedId={selectedId}
                onHover={setHoveredId}
                onSelect={setSelectedId}
              />
            </>
          )}

          <footer className="side-footer">
            {snapshot?.error ? (
              <span className="side-error">{snapshot.error}</span>
            ) : snapshot ? (
              <span>Actualizado {formatUtcTime(snapshot.receivedAt)}</span>
            ) : (
              <span>Conectando con la Realtime Database…</span>
            )}
          </footer>
        </aside>
      </div>
    </div>
  )
}
