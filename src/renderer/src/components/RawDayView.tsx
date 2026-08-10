import type { TableColumn } from './EventsTable'
import { EventsTable } from './EventsTable'
import { useRawDay } from '../hooks/useRawDay'

interface Props {
  day: string
  onBack: () => void
}

/**
 * El drill-in de Raw: las requests HTTP tal cual llegaron al ingestor ese
 * día. Pocos campos por fila — recepción, ruta, tamaño, archivo — y el
 * payload completo (el batch crudo del SDK) en su celda: click y se abre el
 * popup con el JSON entero.
 */
const COLUMNS: TableColumn[] = [
  { name: 'recibido', label: 'recibido', hint: 'timestamp de recepción en el ingestor (UTC)' },
  { name: 'ruta', label: 'ruta', hint: 'path del POST' },
  { name: 'bytes_payload', label: 'bytes', hint: 'tamaño del cuerpo de la request' },
  { name: 'archivo', label: 'archivo', hint: 'objeto de S3 del que salió (flush de Vector)' },
  { name: 'payload', label: 'payload', hint: 'el cuerpo crudo del POST — click para abrirlo' },
]

export function RawDayView({ day, onBack }: Props) {
  const { rows, total, sort, loading, error, toggleSort, loadMore } = useRawDay(day)

  return (
    <>
      <div className="workspace-bar">
        <button className="day-back" onClick={onBack}>
          ← Volver al inventario
        </button>
        <span>
          <strong>{rows.length}</strong> de {total} requests · {day}
        </span>
        <span className="workspace-schema">
          raw: el POST tal cual llegó, antes de cualquier transformación
        </span>
      </div>

      {error && <p className="workspace-warning">{error}</p>}

      <EventsTable
        columns={COLUMNS}
        rows={rows}
        total={total}
        sort={sort}
        loading={loading}
        emptyText={loading ? 'Leyendo el día…' : `No hay requests en ${day}.`}
        onSort={toggleSort}
        onLoadMore={loadMore}
      />
    </>
  )
}
