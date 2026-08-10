import { useMemo } from 'react'
import type { TableColumn } from './EventsTable'
import { EventsTable } from './EventsTable'
import { useDayEvents } from '../hooks/useDayEvents'

interface Props {
  day: string
  onBack: () => void
}

/**
 * El drill-in del inventario de Bronze: TODOS los eventos de una partición
 * diaria, en la misma tabla de siempre — columnas del contrato declarado,
 * orden por header, celdas JSON con popup, virtualizada.
 */
export function DayEventsView({ day, onBack }: Props) {
  const { schema, rows, total, sort, loading, error, toggleSort, loadMore } = useDayEvents(day)

  // En bronze el label ES el nombre técnico, y el tooltip lleva el tipo.
  const columns = useMemo(
    (): TableColumn[] =>
      (schema?.columns ?? []).map((column) => ({
        name: column.name,
        label: column.name,
        hint: `${column.physicalType}${column.logicalType ? ` (${column.logicalType})` : ''}`,
      })),
    [schema],
  )

  return (
    <>
      <div className="workspace-bar">
        <button className="day-back" onClick={onBack}>
          ← Volver al inventario
        </button>
        <span>
          <strong>{rows.length}</strong> de {total} eventos · {day}
        </span>
        <span className="workspace-schema">
          {schema?.messageName ?? '—'}
          {schema && schema.columns.length > 0 && ` · ${schema.columns.length} columnas declaradas`}
        </span>
      </div>

      {(schema?.error ?? error) && <p className="workspace-warning">{schema?.error ?? error}</p>}

      <EventsTable
        columns={columns}
        rows={rows}
        total={total}
        sort={sort}
        loading={loading}
        emptyText={loading ? 'Leyendo el día…' : `No hay eventos en ${day}.`}
        onSort={toggleSort}
        onLoadMore={loadMore}
      />
    </>
  )
}
