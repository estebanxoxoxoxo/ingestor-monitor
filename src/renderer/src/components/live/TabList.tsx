import type { LiveTab } from '@shared/types'
import { formatDuration, secondsSince } from '../../lib/format'

interface Props {
  tabs: LiveTab[]
  hoveredId: string | null
  selectedId: string | null
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
}

/**
 * Una fila por pestaña abierta — exactamente lo que hay en la base, sin
 * fusionar. Dos pestañas de la misma persona son dos filas; cuánta gente hay
 * lo dice el contador del header.
 */
export function TabList({ tabs, hoveredId, selectedId, onHover, onSelect }: Props) {
  if (tabs.length === 0) {
    return (
      <div className="tab-list-empty">
        <p>Ninguna pestaña abierta en este momento.</p>
        <p className="dim">
          Las entradas aparecen y desaparecen solas: Firebase las borra cuando el navegador se
          desconecta.
        </p>
      </div>
    )
  }

  return (
    <ul className="tab-list" onMouseLeave={() => onHover(null)}>
      {tabs.map((tab) => (
        <li key={tab.id}>
          <button
            className={[
              'tab-item',
              tab.id === selectedId ? 'selected' : '',
              tab.id === hoveredId ? 'hovered' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onMouseEnter={() => onHover(tab.id)}
            onFocus={() => onHover(tab.id)}
            onClick={() => onSelect(tab.id)}
          >
            <span className="tab-dot" />

            <span className="tab-main">
              <span className="tab-place">
                {tab.geo.city ?? 'Sin ciudad'}
                {tab.geo.country && <em>{tab.geo.country}</em>}
                {!tab.located && <span className="tab-tag">sin mapa</span>}
              </span>
              <span className="tab-page">{tab.page ?? '—'}</span>
            </span>

            <span className="tab-meta">
              <span className="tab-events">{tab.eventCount} ev</span>
              {/* Desde que abrió, contando en vivo: el ticker de un segundo
                  re-renderiza y el número sube solo. */}
              <span className="tab-time" title="Tiempo abierta">
                {formatDuration(secondsSince(tab.startedAt))}
              </span>
              <span className={tab.visible ? 'tab-watching on' : 'tab-watching'}>
                {tab.visible ? 'mirando' : 'de fondo'}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
