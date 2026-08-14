import type { LayerId } from '@shared/config'
import type { FreshnessSnapshot, IngestStatus, LayerFreshness } from '@shared/types'
import { formatAgo } from '../lib/format'
import type { View } from '../App'

interface Props {
  view: View
  onView: (view: View) => void
  /** El semáforo del ingestor: pinta el punto de la pestaña Config. */
  ingest: IngestStatus | null
  /** Batches que aterrizaron HOY (UTC) por capa. */
  today: Record<LayerId, number | null> | null
  /** Frescura de cada capa contra la caché local: los puntos de Raw/Bronze. */
  freshness: FreshnessSnapshot | null
}

/** El punto rojo titilante va sólo en Vivo: es la señal de aire. */
const VIEWS: { id: View; label: string; live?: boolean; layer?: LayerId }[] = [
  { id: 'vivo', label: 'Vivo', live: true },
  { id: 'raw', label: 'Raw', layer: 'raw' },
  { id: 'bronze', label: 'Bronze', layer: 'bronze' },
  { id: 'config', label: 'Config' },
]

/** Tooltip del punto de una capa: qué edad tiene el dato más nuevo local. */
function freshHint(entry: LayerFreshness | undefined): string {
  if (!entry || !entry.lastDataAt) return 'La caché nunca recibió datos de esta capa.'
  return `Último dato en la caché: ${formatAgo(entry.lastDataAt)}`
}

export function TopBar({ view, onView, ingest, today, freshness }: Props) {
  const ingestState = ingest?.state ?? 'unknown'
  const ingestHint =
    ingestState === 'up'
      ? `Ingestor escuchando (${ingest?.target}, ${ingest?.latencyMs} ms)`
      : ingestState === 'down'
        ? `Ingestor NO responde (${ingest?.target}): ${ingest?.error ?? ''}`
        : 'Ingestor: todavía sin primer chequeo'

  return (
    <header className="topbar">
      <div className="topbar-left">
        <h1>Ingestor Monitor</h1>
        <span className="badge" title="Todo el análisis es en UTC, sin conversión de husos">
          UTC
        </span>

        <nav className="view-tabs">
          {VIEWS.map((item) => (
            <button
              key={item.id}
              className={item.id === view ? 'view-tab active' : 'view-tab'}
              onClick={() => onView(item.id)}
              title={
                item.id === 'config'
                  ? ingestHint
                  : item.layer
                    ? freshHint(freshness?.[item.layer])
                    : undefined
              }
            >
              {item.live && <span className="live-blink" aria-hidden="true" />}
              {item.layer && (
                <span
                  className={`fresh-dot ${freshness?.[item.layer]?.state ?? 'red'}`}
                  aria-hidden="true"
                />
              )}
              {item.id === 'config' && (
                <span className={`ingest-dot ${ingestState}`} aria-hidden="true" />
              )}
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="topbar-right">
        <span
          className="topbar-ingested"
          title="Batches (archivos) que aterrizaron en el bucket hoy, día UTC. Lo deduce el vigía de cada listado."
        >
          ingestado hoy (UTC):
          <span className="layer-badge raw">raw</span>
          <strong>{today?.raw ?? '—'}</strong>
          <span className="layer-badge bronze">bronze</span>
          <strong>{today?.bronze ?? '—'}</strong>
        </span>
      </div>
    </header>
  )
}
