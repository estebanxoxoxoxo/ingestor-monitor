import { useState } from 'react'
import type { LayerId } from '@shared/config'
import type { DayFileEntry, PipelineLogEntry } from '@shared/types'
import { formatBytes, formatUtcStamp } from '../lib/format'
import { useLayerIndex } from '../hooks/useLayerIndex'
import { DayView } from './DayView'
import { FileView } from './FileView'

interface Props {
  layer: LayerId
  /** Cómo se llama la capa en la UI: 'Raw' o 'Bronze'. */
  title: string
}

interface ViewerTarget {
  day: string
  file: DayFileEntry
}

/**
 * Una capa del bucket, SIN nada local: el índice vive en Firestore — lo
 * alimenta la función de las notificaciones del lake. Arriba, el log con los
 * últimos archivos que aterrizaron (sin ventana) y su vista previa; abajo,
 * el árbol de días. El Full sync (la curación manual) vive en Config.
 */
export function LayerView({ layer, title }: Props) {
  const { state } = useLayerIndex(layer)
  const [day, setDay] = useState<string | null>(null)
  const [viewer, setViewer] = useState<ViewerTarget | null>(null)
  const [filter, setFilter] = useState('')

  if (viewer) {
    return (
      <FileView
        layer={layer}
        day={viewer.day}
        file={viewer.file}
        onBack={() => setViewer(null)}
      />
    )
  }
  if (day) {
    return <DayView layer={layer} day={day} onBack={() => setDay(null)} />
  }

  const needle = filter.trim()
  const days = (state?.days ?? []).filter((entry) => !needle || entry.date.includes(needle))
  const entries = state?.latest ?? []

  /** Ver del log → el viewer de ese archivo (el día sale de la key). */
  const abrir = (entry: PipelineLogEntry): void => {
    const dia = entry.key.match(/dt=(\d{4}-\d{2}-\d{2})\//)?.[1]
    if (!dia) return
    setViewer({
      day: dia,
      file: { name: entry.file, size: entry.size, at: entry.lastModified },
    })
  }

  return (
    <main className="workspace ops-view">
      <div className="workspace-bar">
        <span>
          <strong>{state ? state.files : '—'}</strong> archivos ·{' '}
          {state ? formatBytes(state.bytes) : '—'}
        </span>
      </div>

      {state?.error && <p className="workspace-warning">{state.error}</p>}

      {/* ── El log: los últimos archivos, sin ventana ────────── */}
      <section className="ops-panel">
        <h2 className="ops-title">Ingestado · log</h2>
        {entries.length > 0 ? (
          <table className="ops-table striped">
            <thead>
              <tr>
                <th>Subido</th>
                <th>Capa</th>
                <th>Archivo</th>
                <th>Tamaño</th>
                <th className="ops-num" aria-label="vista previa" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.lastModified ? formatUtcStamp(entry.lastModified) : '—'}</td>
                  <td>
                    <span className={`layer-badge ${entry.layer}`}>{entry.layer}</span>
                  </td>
                  <td className="ops-file" title={entry.key}>
                    {entry.file}
                  </td>
                  <td>{formatBytes(entry.size)}</td>
                  <td className="ops-num">
                    <button
                      className="ver-btn"
                      title="Abrir la vista previa del archivo"
                      onClick={() => abrir(entry)}
                    >
                      Ver
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="ops-empty">Todavía no hay archivos de {title.toLowerCase()} en el índice.</p>
        )}
      </section>

      {/* ── El árbol: días → archivos → viewer ───────────────── */}
      <section className="ops-panel">
        <div className="ops-panel-head">
          <h2 className="ops-title">
            Días en el bucket (UTC) · click en un día para ver sus archivos
          </h2>
          <input
            className="ops-filter"
            type="search"
            placeholder="Buscar día… (2026-08)"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>

        {days.length > 0 ? (
          <table className="ops-table striped">
            <thead>
              <tr>
                <th>Día</th>
                <th>Archivos</th>
                <th>Tamaño</th>
              </tr>
            </thead>
            <tbody>
              {days.map((entry) => (
                <tr
                  key={entry.date}
                  className="ops-row-click"
                  title="Ver los archivos del día"
                  onClick={() => setDay(entry.date)}
                >
                  <td>{entry.date}</td>
                  <td>{entry.files}</td>
                  <td>{formatBytes(entry.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="ops-empty">
            {state === null || !state.listedAt
              ? 'Cargando el índice…'
              : needle
                ? `Ningún día contiene "${needle}".`
                : 'La capa no tiene días en el bucket.'}
          </p>
        )}
      </section>
    </main>
  )
}
