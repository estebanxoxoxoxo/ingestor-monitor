import type { LayerId } from '@shared/config'
import type { IngestStatus, LayerTree, TreeSnapshot } from '@shared/types'
import type { View } from '../App'

interface Props {
  view: View
  onView: (view: View) => void
  /** El semáforo del ingestor: pinta el punto de la pestaña Config. */
  ingest: IngestStatus | null
  /** El árbol mergeado: contadores de hoy y puntos de frescura. */
  tree: TreeSnapshot | null
}

/** El punto rojo titilante va sólo en Vivo: es la señal de aire. */
const VIEWS: { id: View; label: string; live?: boolean; layer?: LayerId }[] = [
  { id: 'vivo', label: 'Vivo', live: true },
  { id: 'raw', label: 'Raw', layer: 'raw' },
  { id: 'bronze', label: 'Bronze', layer: 'bronze' },
  { id: 'config', label: 'Config' },
]

/** Tooltip del punto de una capa: de cuándo es el dato más nuevo. */
function freshHint(layer: LayerTree | undefined): string {
  const newestDay = layer?.days[0]?.date
  if (!newestDay) return 'La capa nunca recibió datos.'
  return `Último día con datos: ${newestDay}`
}

export function TopBar({ view, onView, ingest, tree }: Props) {
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
                    ? freshHint(tree?.[item.layer])
                    : undefined
              }
            >
              {item.live && <span className="live-blink" aria-hidden="true" />}
              {item.layer && (
                <span
                  className={`fresh-dot ${tree?.[item.layer]?.freshness ?? 'black'}`}
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
          title="Archivos que aterrizaron en el bucket hoy, día UTC."
        >
          ingestado hoy (UTC):
          <span className="layer-badge raw">raw</span>
          <strong>{tree ? tree.raw.today.files : '—'}</strong>
          <span className="layer-badge bronze">bronze</span>
          <strong>{tree ? tree.bronze.today.files : '—'}</strong>
        </span>
      </div>
    </header>
  )
}
