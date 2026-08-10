import { useEffect } from 'react'

export interface JsonCell {
  title: string
  /** Subtítulo opcional bajo el título. */
  subtitle?: string
  value: unknown
}

interface Props {
  cell: JsonCell | null
  onClose: () => void
}

export function JsonModal({ cell, onClose }: Props) {
  useEffect(() => {
    if (!cell) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cell, onClose])

  if (!cell) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2>{cell.title}</h2>
            {cell.subtitle && <p className="modal-subtitle">{cell.subtitle}</p>}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>
        <pre className="modal-body">{JSON.stringify(cell.value, null, 2)}</pre>
      </div>
    </div>
  )
}
