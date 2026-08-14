import { useState } from 'react'
import type { LayerId } from '@shared/config'
import type { DayFileEntry, LayerTree, TodayLogEntry } from '@shared/types'
import { formatBytes, formatUtcStamp } from '../lib/format'
import { DayView } from './DayView'
import { FileView } from './FileView'

interface Props {
  layer: LayerId
  /** Cómo se llama la capa en la UI: 'Raw' o 'Bronze'. */
  title: string
  /** El árbol mergeado de ESTA capa. La suscripción vive en App. */
  tree: LayerTree | null
}

interface ViewerTarget {
  day: string
  file: DayFileEntry
}

/**
 * Una capa del bucket. Arriba, el log de lo que aterrizó HOY (en vivo) con
 * su vista previa; abajo, el árbol de días. Todo sale del snapshot mergeado
 * que baja por props — acá no se pide nada.
 */
export function LayerView({ layer, title, tree }: Props) {
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
  const days = (tree?.days ?? []).filter((entry) => !needle || entry.date.includes(needle))
  const entries = tree?.latest ?? []

  /** Ver del log → el viewer de ese archivo. */
  const openViewer = (entry: TodayLogEntry): void => {
    setViewer({
      day: entry.day,
      file: { name: entry.file, size: entry.size, at: entry.at },
    })
  }

  return (
    <main className="workspace ops-view">
      <div className="workspace-bar">
        <span>
          <strong>{tree ? tree.files : '—'}</strong> archivos ·{' '}
          {tree ? formatBytes(tree.bytes) : '—'}
        </span>
      </div>

      {tree?.error && <p className="workspace-warning">{tree.error}</p>}

      {/* ── El log: lo ingestado hoy, en vivo ────────────────── */}
      <section className="ops-panel">
        <h2 className="ops-title">Ingestado hoy (UTC) · log</h2>
        {entries.length > 0 ? (
          <table className="ops-table striped">
            <thead>
              <tr>
                <th>Subido</th>
                <th>Archivo</th>
                <th>Tamaño</th>
                <th className="ops-num" aria-label="vista previa" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.file}>
                  <td>{entry.at ? formatUtcStamp(entry.at) : '—'}</td>
                  <td className="ops-file">{entry.file}</td>
                  <td>{formatBytes(entry.size)}</td>
                  <td className="ops-num">
                    <button
                      className="ver-btn"
                      title="Abrir la vista previa del archivo"
                      onClick={() => openViewer(entry)}
                    >
                      Ver
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="ops-empty">
            Hoy todavía no aterrizó ningún archivo de {title.toLowerCase()}.
          </p>
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
            {!tree?.loaded
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
