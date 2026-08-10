import { useState } from 'react'
import type { LiveEvent, LiveSession } from '@shared/types'
import { formatAgo, formatDuration, formatUtcTime } from '../../lib/format'
import type { JsonCell } from '../JsonModal'
import { JsonModal } from '../JsonModal'

interface Props {
  session: LiveSession
  onBack: () => void
}

/**
 * Todo lo que se sabe de una sesión, en vivo: mientras el nodo cambia, este
 * panel se vuelve a renderizar con la sesión actualizada.
 */
export function SessionDetail({ session, onBack }: Props) {
  const [openCell, setOpenCell] = useState<JsonCell | null>(null)

  const events = session.connections.flatMap((c) => c.events)
  events.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))

  /**
   * El crudo se pide recién acá: mandarlo en cada snapshot duplicaba el
   * payload de la vista para algo que se mira de a uno.
   */
  const openEvent = async (event: LiveEvent): Promise<void> => {
    const raw = await window.api.getLiveEvent(event.connectionId, event.id)
    setOpenCell({
      title: event.name,
      subtitle: event.at ? formatUtcTime(event.at) : undefined,
      value: raw ?? { error: 'La sesión se cerró antes de poder traer el evento.' },
    })
  }

  return (
    <div className="session-detail">
      <header className="detail-header">
        <button className="detail-back" onClick={onBack} aria-label="Volver a la lista">
          ←
        </button>
        <div>
          <h2>
            {session.geo.city ?? 'Sin ciudad'}
            {session.geo.region && `, ${session.geo.region}`}
          </h2>
          <p className="detail-sub">
            {session.geo.country ?? 'sin país'}
            {session.geo.lat !== null && session.geo.lng !== null && (
              <> · {session.geo.lat.toFixed(3)}, {session.geo.lng.toFixed(3)}</>
            )}
          </p>
        </div>
      </header>

      <dl className="detail-grid">
        <Field label="Sesión" value={session.id} mono />
        <Field label="Agrupada por" value={label(session.groupedBy)} />
        <Field label="anonymous_id" value={session.anonymousId ?? '—'} mono />
        <Field label="Página" value={session.page ?? '—'} mono />
        <Field label="Inicio" value={session.startedAt ? formatUtcTime(session.startedAt) : '—'} />
        <Field label="Última señal" value={formatAgo(session.lastSeen)} />
        <Field label="Tiempo comprometido" value={formatDuration(session.engagedTimeSec)} />
        <Field label="Conexiones" value={String(session.connections.length)} />
      </dl>

      {Object.keys(session.eventsByName).length > 0 && (
        <div className="detail-tags">
          {Object.entries(session.eventsByName)
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => (
              <span className="detail-tag" key={name}>
                {name} <strong>{count}</strong>
              </span>
            ))}
        </div>
      )}

      <h3 className="detail-section">
        Eventos <span>{events.length}</span>
      </h3>

      {/* Una línea por evento; el detalle completo va al popup. */}
      <ol className="detail-events">
        {events.map((event) => (
          <li key={event.id}>
            <button
              className="event-row"
              onClick={() => void openEvent(event)}
              title="Ver el evento completo"
            >
              <span className="event-time">{event.at ? formatUtcTime(event.at) : '—'}</span>
              <span className="event-name">{event.name}</span>
              {event.values.length > 0 && (
                <span className="event-count">{event.values.length}</span>
              )}
              <span className="event-chevron" aria-hidden="true">
                ›
              </span>
            </button>
          </li>
        ))}
        {events.length === 0 && <li className="dim">Sin eventos todavía.</li>}
      </ol>

      <JsonModal cell={openCell} onClose={() => setOpenCell(null)} />
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined} title={value}>
        {value}
      </dd>
    </div>
  )
}

const label = (by: LiveSession['groupedBy']): string =>
  by === 'session_id'
    ? 'session_id'
    : by === 'anonymous_id'
      ? 'anonymous_id (falta session_id)'
      : 'nada: la conexión va sola'
