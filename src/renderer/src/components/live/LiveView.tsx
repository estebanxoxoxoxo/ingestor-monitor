import { useEffect, useState } from 'react'
import type { EventDefinition, EventGroup } from '@shared/types'
import { formatUtcTime } from '../../lib/format'
import { useLive, useTicker } from '../../hooks/useLive'
import { LiveHeader } from './LiveHeader'
import { SessionDetail } from './SessionDetail'
import { SessionList } from './SessionList'
import { WorldMap } from './WorldMap'

interface Props {
  active: boolean
  catalog: EventDefinition[]
  groups: EventGroup[]
  declared: boolean
}

export function LiveView({ active, catalog, groups, declared }: Props) {
  const snapshot = useLive(active)
  useTicker(active) // refresca los "hace 12s" sin depender de que llegue data

  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const sessions = snapshot?.sessions ?? []
  const selected = sessions.find((s) => s.id === selectedId) ?? null

  // Si la sesión abierta se cierra del otro lado, se vuelve a la lista sola.
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null)
  }, [selectedId, selected])

  return (
    <div className="live-view">
      <LiveHeader snapshot={snapshot} catalog={catalog} groups={groups} declared={declared} />

      <div className="live-body">
        <WorldMap
          sessions={sessions}
          hoveredId={hoveredId}
          selectedId={selectedId}
          onHover={setHoveredId}
          onSelect={setSelectedId}
        />

        <aside className="live-side">
          {selected ? (
            <SessionDetail session={selected} onBack={() => setSelectedId(null)} />
          ) : (
            <>
              <header className="side-header">
                <h2>Sesiones</h2>
                <span>{sessions.length}</span>
              </header>
              <SessionList
                sessions={sessions}
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
