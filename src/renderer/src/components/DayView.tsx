import { useState } from 'react'
import type { LayerId } from '@shared/config'
import type { DayFileEntry } from '@shared/types'
import { formatBytes, formatUtcStamp } from '../lib/format'
import { useDayFiles } from '../hooks/useDayFiles'
import { FileView } from './FileView'

interface Props {
  layer: LayerId
  day: string
  onBack: () => void
}

/**
 * Los ARCHIVOS de un día, del índice (Firestore/vigía): nombres, pesos y
 * fechas — acá no se toca data. Click en un nombre → el viewer de ese
 * archivo, pedido al lake al momento.
 */
export function DayView({ layer, day, onBack }: Props) {
  const data = useDayFiles(layer, day)
  const [file, setFile] = useState<DayFileEntry | null>(null)

  if (file) {
    return <FileView layer={layer} day={day} file={file} onBack={() => setFile(null)} />
  }

  return (
    <main className="workspace ops-view">
      <div className="workspace-bar">
        <button className="day-back" onClick={onBack}>
          ← Volver a los días
        </button>
        <span>
          <strong>{data ? data.files.length : '—'}</strong> archivos ·{' '}
          {data ? formatBytes(data.bytes) : '—'} · {day}
        </span>
        <span className="workspace-schema">
          del índice — la data no se toca hasta abrir un archivo
        </span>
      </div>

      {data?.error && <p className="workspace-warning">{data.error}</p>}

      <section className="ops-panel">
        {data && data.files.length > 0 ? (
          <table className="ops-table striped">
            <thead>
              <tr>
                <th>Archivo</th>
                <th>Peso</th>
                <th>Subido</th>
              </tr>
            </thead>
            <tbody>
              {data.files.map((entry) => (
                <tr
                  key={entry.name}
                  className="ops-row-click"
                  title="Abrir el archivo en el viewer"
                  onClick={() => setFile(entry)}
                >
                  <td className="ops-file">{entry.name}</td>
                  <td>{formatBytes(entry.size)}</td>
                  <td>{entry.at ? formatUtcStamp(entry.at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="ops-empty">
            {data === null ? 'Leyendo el índice…' : `No hay archivos en ${day}.`}
          </p>
        )}
      </section>
    </main>
  )
}
