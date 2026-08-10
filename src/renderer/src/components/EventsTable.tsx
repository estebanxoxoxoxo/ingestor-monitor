import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { parseJsonCell, summarizeJson } from '../lib/json'
import type { SortState } from '../hooks/useDayEvents'
import type { JsonCell } from './JsonModal'
import { JsonModal } from './JsonModal'

/** Tiene que coincidir con el alto de fila del CSS. */
const ROW_HEIGHT = 30
/** Cuántas filas antes del final disparan el pedido de la próxima página. */
const PREFETCH_ROWS = 40

/**
 * Una columna de la tabla. La misma tabla sirve a Bronze (columnas del
 * contrato, label = nombre técnico) y a Silver (columnas del manifest,
 * label elegido por el usuario).
 */
export interface TableColumn {
  /** Clave de la fila y columna del ORDER BY. */
  name: string
  /** Lo que se ve en el encabezado. */
  label: string
  /** Tooltip del encabezado: tipo, origen, lo que ayude. */
  hint?: string
  /** Cómo mostrar la celda. El valor completo queda en el tooltip. */
  format?: (value: unknown) => string
  /** true = clickear la celda copia el valor COMPLETO al portapapeles. */
  copy?: boolean
}

interface Props {
  columns: TableColumn[]
  rows: Record<string, unknown>[]
  total: number
  sort: SortState
  loading: boolean
  /** Qué decir cuando no hay filas: cada pestaña tiene su motivo. */
  emptyText: string
  onSort: (column: string) => void
  onLoadMore: () => void
}

export function EventsTable({
  columns,
  rows,
  total,
  sort,
  loading,
  emptyText,
  onSort,
  onLoadMore,
}: Props) {
  const [openCell, setOpenCell] = useState<JsonCell | null>(null)
  const wrap = useRef<HTMLDivElement>(null)

  /**
   * Sólo se dibujan las filas visibles. Sin esto, ordenar con decenas de miles
   * de filas obliga al navegador a rehacer todo el DOM de la tabla.
   */
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => wrap.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  const items = virtualizer.getVirtualItems()
  const last = items[items.length - 1]

  // Al acercarse al final se pide la página siguiente.
  useEffect(() => {
    if (!last) return
    if (last.index >= rows.length - PREFETCH_ROWS && rows.length < total) onLoadMore()
  }, [last, rows.length, total, onLoadMore])

  // Reordenar deja la tabla scrolleada a la mitad mirando filas del medio.
  useEffect(() => {
    wrap.current?.scrollTo({ top: 0 })
  }, [sort.column, sort.direction])

  const paddingTop = items[0]?.start ?? 0
  const paddingBottom = virtualizer.getTotalSize() - (last ? last.end : 0)

  return (
    <>
      <div ref={wrap} className={loading ? 'table-wrap loading' : 'table-wrap'}>
        <table className="events-table">
          <thead>
            <tr>
              {columns.map((column) => {
                const active = sort.column === column.name
                return (
                  <th
                    key={column.name}
                    className={active ? 'sorted' : undefined}
                    onClick={() => onSort(column.name)}
                    title={column.hint ?? column.name}
                  >
                    <span className="th-label">{column.label}</span>
                    <span className="th-arrow">
                      {active ? (sort.direction === 'desc' ? '▼' : '▲') : ''}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {/* Filas de relleno: sostienen el alto que no se dibuja. */}
            {paddingTop > 0 && <tr style={{ height: paddingTop }} />}
            {items.map((item) => (
              <tr key={item.key} style={{ height: ROW_HEIGHT }}>
                {columns.map((column) => (
                  <Cell
                    key={column.name}
                    column={column.name}
                    value={rows[item.index]?.[column.name]}
                    format={column.format}
                    copy={column.copy}
                    onOpen={setOpenCell}
                  />
                ))}
              </tr>
            ))}
            {paddingBottom > 0 && <tr style={{ height: paddingBottom }} />}
          </tbody>
        </table>

        {rows.length === 0 && !loading && <p className="table-empty">{emptyText}</p>}
      </div>

      <JsonModal cell={openCell} onClose={() => setOpenCell(null)} />
    </>
  )
}

interface CellProps {
  column: string
  value: unknown
  format?: (value: unknown) => string
  copy?: boolean
  onOpen: (cell: JsonCell) => void
}

function Cell({ column, value, format, copy, onOpen }: CellProps) {
  if (value === null || value === undefined) {
    return (
      <td className="cell-null" title="NULL">
        —
      </td>
    )
  }

  if (copy) {
    return <CopyCell value={value} format={format} />
  }

  // Con formateador manda el formateador; el valor entero queda en el tooltip.
  if (format) {
    return <td title={String(value)}>{format(value)}</td>
  }

  const json = parseJsonCell(value)
  if (json !== null) {
    return (
      <td className="cell-json">
        <button onClick={() => onOpen({ title: column, value: json })} title="Ver el JSON completo">
          {summarizeJson(json)}
        </button>
      </td>
    )
  }

  const text = String(value)
  return (
    <td className={typeof value === 'number' ? 'cell-number' : undefined} title={text}>
      {text}
    </td>
  )
}

/**
 * La celda muestra el valor recortado, pero un click copia el COMPLETO al
 * portapapeles y lo confirma un instante en el lugar.
 */
function CopyCell({ value, format }: { value: unknown; format?: (value: unknown) => string }) {
  const [copied, setCopied] = useState(false)
  const full = String(value)

  return (
    <td
      className="cell-copy"
      title={`${full} · click para copiar`}
      onClick={() => {
        void navigator.clipboard.writeText(full).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 900)
        })
      }}
    >
      {copied ? '✓ copiado' : format ? format(value) : full}
    </td>
  )
}
