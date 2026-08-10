import type { LiveSession } from '@shared/types'
import { formatAgo, formatDuration } from '../../lib/format'

interface Props {
  sessions: LiveSession[]
  hoveredId: string | null
  selectedId: string | null
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
}

export function SessionList({ sessions, hoveredId, selectedId, onHover, onSelect }: Props) {
  if (sessions.length === 0) {
    return (
      <div className="session-list-empty">
        <p>Ninguna sesión abierta en este momento.</p>
        <p className="dim">
          Las entradas aparecen y desaparecen solas: Firebase las borra cuando el navegador se
          desconecta.
        </p>
      </div>
    )
  }

  return (
    <ul className="session-list" onMouseLeave={() => onHover(null)}>
      {sessions.map((session) => (
        <li key={session.id}>
          <button
            className={[
              'session-item',
              session.id === selectedId ? 'selected' : '',
              session.id === hoveredId ? 'hovered' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onMouseEnter={() => onHover(session.id)}
            onFocus={() => onHover(session.id)}
            onClick={() => onSelect(session.id)}
          >
            <span className="session-dot" />

            <span className="session-main">
              <span className="session-place">
                {session.geo.city ?? 'Sin ciudad'}
                {session.geo.country && <em>{session.geo.country}</em>}
                {!session.located && <span className="session-tag">sin mapa</span>}
              </span>
              <span className="session-page">{session.page ?? '—'}</span>
            </span>

            <span className="session-meta">
              <span className="session-events">{session.eventCount} ev</span>
              <span className="session-time">{formatDuration(session.engagedTimeSec)}</span>
              <span className="session-seen">{formatAgo(session.lastSeen)}</span>
            </span>

            {session.connections.length > 1 && (
              <span className="session-tabs" title={`${session.connections.length} pestañas`}>
                ×{session.connections.length}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}
