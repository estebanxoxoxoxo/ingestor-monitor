import { useCallback, useEffect, useRef, useState } from 'react'
import { EVENTS_PAGE_SIZE } from '@shared/config'
import type { EventsPage } from '@shared/types'
import type { SortState } from './useDayEvents'

/** Las requests más recientes primero: es el orden útil por defecto. */
const INITIAL_SORT: SortState = { column: 'recibido', direction: 'desc' }

/**
 * Las requests crudas de UNA partición diaria de raw. Mismo patrón que el
 * drill-in de bronze: páginas acumuladas, tabla virtualizada, y un número de
 * vigencia por consulta para que una respuesta tardía no pise a la vigente.
 */
export function useRawDay(day: string) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [sort, setSort] = useState<SortState>(INITIAL_SORT)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)

  const requestId = useRef(0)

  const fetchPage = useCallback(
    async (next: SortState, offset: number): Promise<void> => {
      const id = ++requestId.current
      setLoading(true)
      try {
        const page: EventsPage = await window.api.getRawEvents({
          sortColumn: next.column,
          sortDirection: next.direction,
          day,
          limit: EVENTS_PAGE_SIZE,
          offset,
        })
        if (id !== requestId.current) return // llegó tarde: hay otra vigente
        setError(page.error)
        setTotal(page.total)
        setRows((current) => (offset === 0 ? page.rows : [...current, ...page.rows]))
      } finally {
        if (id === requestId.current) setLoading(false)
      }
    },
    [day],
  )

  useEffect(() => {
    setRows([])
    setSort(INITIAL_SORT)
    void fetchPage(INITIAL_SORT, 0)
  }, [fetchPage])

  /** Primer clic ordena de mayor a menor; el siguiente invierte. */
  const toggleSort = useCallback(
    (column: string): void => {
      const next: SortState =
        sort.column === column && sort.direction === 'desc'
          ? { column, direction: 'asc' }
          : { column, direction: 'desc' }
      setSort(next)
      setRows([])
      void fetchPage(next, 0)
    },
    [sort, fetchPage],
  )

  const loadMore = useCallback((): void => {
    if (loading || rows.length >= total) return
    void fetchPage(sort, rows.length)
  }, [loading, rows.length, total, sort, fetchPage])

  return { rows, total, sort, loading, error, toggleSort, loadMore }
}
