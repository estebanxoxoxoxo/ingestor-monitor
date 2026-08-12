import { useState } from 'react'
import { SAMPLE_ROW_CAP } from '@shared/config'
import type { LayerId } from '@shared/config'
import type { DayFileEntry } from '@shared/types'
import { parseJsonCell, summarizeJson } from '../lib/json'
import { formatBytes } from '../lib/format'
import { useFileSample } from '../hooks/useFileSample'
import type { JsonCell } from './JsonModal'
import { JsonModal } from './JsonModal'

interface Props {
  layer: LayerId
  day: string
  file: DayFileEntry
  onBack: () => void
}

/** 'YYYY-MM-DD HH:MM:SS UTC' para timestamps ISO; lo demás, tal cual. */
const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  const text = String(value)
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/)
  return iso ? `${iso[1]} ${iso[2]} UTC` : text
}

/**
 * Lo que hay adentro de una celda si es JSON: varias columnas del esquema
 * son string con JSON adentro (context, properties, traits, integrations) y
 * el contrato no las distingue de un texto común — se reconocen por el
 * valor. null = no es JSON.
 */
function jsonOf(value: unknown): unknown | null {
  if (typeof value === 'object' && value !== null) return value
  return parseJsonCell(value)
}


/**
 * El viewer de UN archivo: su contenido leído de S3 al momento, volátil.
 *
 * En bronze la tabla ya trae TODAS las columnas del parquet, así que no hay
 * botón Ver: las celdas que son JSON muestran su resumen y abren el visor
 * al tocarlas. En raw, en cambio, la fila es una request y el payload
 * completo vive aparte: ahí sí hay Ver.
 */
export function FileView({ layer, day, file, onBack }: Props) {
  const sample = useFileSample(layer, day, file.name)
  const [open, setOpen] = useState<JsonCell | null>(null)

  const rows = sample?.rows ?? []
  // TODAS las columnas del parquet, vengan o no con valor: las vacías son
  // parte del esquema y también se inspeccionan. La tabla scrollea.
  const columns = sample?.columns ?? []
  const esRaw = layer === 'raw'

  /** Raw: el payload crudo del POST viaja en `registro` (columna oculta). */
  const verRegistro = (row: Record<string, unknown>): void => {
    const registro = row.registro
    setOpen({
      title: file.name,
      subtitle: `recibido ${cellText(row.recibido)}`,
      value: typeof registro === 'string' ? (parseJsonCell(registro) ?? registro) : registro,
    })
  }

  const verColumna = (column: string, row: Record<string, unknown>, value: unknown): void => {
    setOpen({
      title: column,
      subtitle: [row.event, row.message_id].filter(Boolean).map(String).join(' · '),
      value,
    })
  }

  return (
    <main className="workspace ops-view">
      <div className="workspace-bar">
        <button className="day-back" onClick={onBack}>
          ← Volver a los archivos
        </button>
        <span>
          <strong>{rows.length}</strong> {esRaw ? 'requests' : 'eventos'} · {file.name} ·{' '}
          {formatBytes(file.size)}
        </span>
        <span className="workspace-schema">
          {esRaw
            ? 'raw: cada POST tal cual llegó — leído directo de S3, volátil'
            : 'bronze: los eventos del parquet — click en una celda JSON para verla'}
        </span>
      </div>

      {sample?.error && <p className="workspace-warning">{sample.error}</p>}
      {sample?.truncated && (
        <p className="workspace-warning">
          El archivo tiene más de {SAMPLE_ROW_CAP} filas: se muestran las más nuevas.
        </p>
      )}

      <section className="ops-panel">
        {rows.length > 0 ? (
          <div className="ops-scroll">
            <table className="ops-table striped">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                  {esRaw && <th className="ops-num">registro</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index}>
                    {columns.map((column) => {
                      const value = row[column]
                      const json = jsonOf(value)
                      if (json) {
                        return (
                          <td key={column}>
                            <button
                              className="json-cell"
                              title="Ver el JSON completo"
                              onClick={() => verColumna(column, row, json)}
                            >
                              {summarizeJson(json)}
                            </button>
                          </td>
                        )
                      }
                      return (
                        <td key={column} className="ops-cell" title={cellText(value)}>
                          {column === 'bytes_payload' && typeof value === 'number'
                            ? formatBytes(value)
                            : cellText(value)}
                        </td>
                      )
                    })}
                    {esRaw && (
                      <td className="ops-num">
                        <button className="ver-btn" onClick={() => verRegistro(row)}>
                          Ver
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ops-empty">
            {sample === null ? 'Pidiendo el archivo a S3…' : 'El archivo no tiene filas.'}
          </p>
        )}
      </section>

      <JsonModal cell={open} onClose={() => setOpen(null)} />
    </main>
  )
}
