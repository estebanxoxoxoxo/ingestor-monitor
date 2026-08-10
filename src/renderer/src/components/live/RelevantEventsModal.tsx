import { useEffect, useRef, useState } from 'react'
import type { EventDefinition } from '@shared/types'

interface Props {
  open: boolean
  /** Todos los eventos que el registro declara. */
  available: EventDefinition[]
  /** Nombres elegidos, en orden. */
  selected: string[]
  onSave: (names: string[]) => void
  onClose: () => void
}

/**
 * Elige qué eventos van a la línea de relevantes y en qué orden.
 * El orden se arrastra; agregar y quitar es un clic.
 */
export function RelevantEventsModal({ open, available, selected, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<string[]>(selected)
  const [over, setOver] = useState<number | null>(null)
  // El índice que se arrastra va en un ref además del estado: el `drop` lo
  // necesita ya escrito, y un re-render de React no está garantizado entre el
  // `dragstart` y el `drop`. El estado sólo maneja el resaltado.
  const dragIndex = useRef<number | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)

  // Al abrir se parte de lo guardado; cerrar sin guardar no deja rastro.
  useEffect(() => {
    if (open) setDraft(selected)
  }, [open, selected])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const rest = available.filter((event) => !draft.includes(event.name))
  const labelOf = (name: string): string =>
    available.find((event) => event.name === name)?.label ?? name

  const move = (from: number, to: number): void => {
    if (from === to) return
    const next = [...draft]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    setDraft(next)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-relevant" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2>Eventos relevantes</h2>
            <p className="modal-subtitle">
              Elegí cuáles se muestran y arrastrá para ordenarlos
            </p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>

        <div className="relevant-body">
          <section>
            <h3>
              En la línea <span>{draft.length}</span>
            </h3>
            {draft.length === 0 ? (
              <p className="relevant-empty">Todavía no elegiste ninguno.</p>
            ) : (
              <ol className="relevant-picked">
                {draft.map((name, index) => (
                  <li
                    key={name}
                    draggable
                    className={[
                      'relevant-item',
                      dragging === index ? 'dragging' : '',
                      over === index && dragging !== index ? 'over' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onDragStart={() => {
                      dragIndex.current = index
                      setDragging(index)
                    }}
                    onDragEnd={() => {
                      dragIndex.current = null
                      setDragging(null)
                      setOver(null)
                    }}
                    onDragOver={(event) => {
                      event.preventDefault()
                      setOver(index)
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (dragIndex.current !== null) move(dragIndex.current, index)
                      dragIndex.current = null
                      setDragging(null)
                      setOver(null)
                    }}
                  >
                    <span className="relevant-grip" aria-hidden="true">
                      ⠿
                    </span>
                    <span className="relevant-order">{index + 1}</span>
                    <span className="relevant-name" title={name}>
                      {labelOf(name)}
                    </span>
                    <button
                      className="relevant-remove"
                      onClick={() => setDraft(draft.filter((n) => n !== name))}
                      aria-label={`Quitar ${labelOf(name)}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section>
            <h3>
              Disponibles <span>{rest.length}</span>
            </h3>
            {rest.length === 0 ? (
              <p className="relevant-empty">
                {available.length === 0
                  ? 'El registro todavía no declara eventos.'
                  : 'Ya están todos en la línea.'}
              </p>
            ) : (
              <ul className="relevant-available">
                {rest.map((event) => (
                  <li key={event.name}>
                    <button onClick={() => setDraft([...draft, event.name])} title={event.name}>
                      <span className="relevant-plus" aria-hidden="true">
                        +
                      </span>
                      {event.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <footer className="relevant-footer">
          <button className="relevant-cancel" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="relevant-save"
            onClick={() => {
              onSave(draft)
              onClose()
            }}
          >
            Guardar
          </button>
        </footer>
      </div>
    </div>
  )
}
