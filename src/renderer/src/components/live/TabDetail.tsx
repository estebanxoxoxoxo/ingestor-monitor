import { useState } from 'react'
import type { LiveEvent, LiveTab } from '@shared/types'
import { formatAgo, formatDuration, formatUtcTime, secondsSince } from '../../lib/format'
import type { JsonCell } from '../JsonModal'
import { JsonModal } from '../JsonModal'

interface Props {
  tab: LiveTab
  onBack: () => void
}

/**
 * Todo lo que se sabe de UNA pestaña, en vivo: mientras el nodo cambia, este
 * panel se vuelve a renderizar con lo último.
 */
export function TabDetail({ tab, onBack }: Props) {
  const [openCell, setOpenCell] = useState<JsonCell | null>(null)

  /**
   * El crudo se pide recién acá: mandarlo en cada snapshot duplicaba el
   * payload de la vista para algo que se mira de a uno.
   */
  const openEvent = async (event: LiveEvent): Promise<void> => {
    const raw = await window.api.getLiveEvent(event.tabId, event.id)
    setOpenCell({
      title: event.name,
      subtitle: event.at ? formatUtcTime(event.at) : undefined,
      value: raw ?? { error: 'La pestaña se cerró antes de poder traer el evento.' },
    })
  }

  return (
    <div className="tab-detail">
      <header className="detail-header">
        <button className="detail-back" onClick={onBack} aria-label="Volver a la lista">
          ←
        </button>
        <div>
          <h2>
            {tab.geo.city ?? 'Sin ciudad'}
            {tab.geo.region && `, ${tab.geo.region}`}
          </h2>
          <p className="detail-sub">
            {tab.geo.country ?? 'sin país'}
            {tab.geo.lat !== null && tab.geo.lng !== null && (
              <> · {tab.geo.lat.toFixed(3)}, {tab.geo.lng.toFixed(3)}</>
            )}
          </p>
        </div>
      </header>

      <dl className="detail-grid">
        <Field label="Pestaña" value={tab.id} mono />
        <Field label="anonymous_id" value={tab.anonymousId ?? '—'} mono />
        <Field label="session_id" value={tab.sessionId ?? '—'} mono />
        <Field label="Página" value={tab.page ?? '—'} mono />
        <Field label="Inicio" value={tab.startedAt ? formatUtcTime(tab.startedAt) : '—'} />
        {/* Sube de a un segundo: se recalcula contra el reloj en cada render. */}
        <Field label="Abierta hace" value={formatDuration(secondsSince(tab.startedAt))} />
        <Field label="Atención" value={tab.visible ? 'Mirando' : 'De fondo'} />
        {/* Cuándo escribió por última vez. No mide presencia — sin latido,
            quien lee sin tocar nada no escribe: presente es estar en la lista.
            Sirve para ver si el nodo se está moviendo. */}
        <Field label="Última escritura" value={formatAgo(tab.lastSeen)} />
        <Field label="Tiempo comprometido" value={formatDuration(tab.engagedTimeSec)} />
      </dl>

      {Object.keys(tab.eventsByName).length > 0 && (
        <div className="detail-tags">
          {Object.entries(tab.eventsByName)
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => (
              <span className="detail-tag" key={name}>
                {name} <strong>{count}</strong>
              </span>
            ))}
        </div>
      )}

      <h3 className="detail-section">
        Eventos <span>{tab.events.length}</span>
      </h3>

      {/* Una línea por evento; el detalle completo va al popup. */}
      <ol className="detail-events">
        {tab.events.map((event) => (
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
        {tab.events.length === 0 && <li className="dim">Sin eventos todavía.</li>}
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
