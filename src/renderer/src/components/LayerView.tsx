import { useState } from 'react'
import type { LayerId } from '@shared/config'
import type { SyncProgress, SyncResult } from '@shared/types'
import { formatBytes, formatUtcInstant } from '../lib/format'
import { useLayerSync } from '../hooks/useLayerSync'
import { DayEventsView } from './DayEventsView'
import { RawDayView } from './RawDayView'

interface Props {
  layer: LayerId
  /** Cómo se llama la capa en la UI: 'Raw' o 'Bronze'. */
  title: string
}

/**
 * Una capa del bucket: su espejo local, el botón de sync y el inventario por
 * partición diaria. El filesystem es el inventario — lo que se lista acá es
 * lo que hay en disco, no una promesa.
 *
 * Un click en un día abre su contenido: en Bronze, los eventos con las
 * columnas del contrato declarado; en Raw, las requests crudas con el
 * payload completo en popup.
 */
export function LayerView({ layer, title }: Props) {
  const { state, progress, result, busy, sync } = useLayerSync(layer)
  const [day, setDay] = useState<string | null>(null)

  // El drill-in usa el layout de tabla a pantalla completa, sin el padding
  // del inventario: la tabla virtualizada necesita su alto.
  if (day) {
    return (
      <main className="workspace">
        {layer === 'bronze' ? (
          <DayEventsView day={day} onBack={() => setDay(null)} />
        ) : (
          <RawDayView day={day} onBack={() => setDay(null)} />
        )}
      </main>
    )
  }

  return (
    <main className="workspace ops-view">
      <div className="workspace-bar">
        <span>
          <strong>{state ? state.files : '—'}</strong> archivos ·{' '}
          {state ? formatBytes(state.bytes) : '—'}
        </span>
        <span className="workspace-schema">
          última sync: {state?.lastSyncAt ? formatUtcInstant(state.lastSyncAt) : 'nunca'}
        </span>
        <button className="sync-button" onClick={() => void sync()} disabled={busy}>
          <span className={busy ? 'sync-icon spinning' : 'sync-icon'} aria-hidden="true">
            ⟳
          </span>
          {busy ? 'Sincronizando…' : `${title} sync`}
        </button>
      </div>

      {state?.error && <p className="workspace-warning">{state.error}</p>}

      <SyncFeedback progress={progress} result={result} busy={busy} />

      <section className="ops-panel">
        <h2 className="ops-title">
          Inventario por día (UTC) · click en un día para ver su contenido
        </h2>
        {state && state.days.length > 0 ? (
          <table className="ops-table">
            <thead>
              <tr>
                <th>Día</th>
                <th>Archivos</th>
                <th>Tamaño</th>
              </tr>
            </thead>
            <tbody>
              {state.days.map((entry) => (
                <tr
                  key={entry.date}
                  className="ops-row-click"
                  title={
                    layer === 'bronze'
                      ? 'Ver todos los eventos del día'
                      : 'Ver las requests crudas del día'
                  }
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
            El espejo local está vacío: corré «{title} sync» para traer la capa del bucket.
          </p>
        )}
      </section>

      {state?.cacheDir && <code className="path">{state.cacheDir}</code>}
    </main>
  )
}

/** La cara de la sync: barra de progreso mientras corre, desenlace al final. */
function SyncFeedback({
  progress,
  result,
  busy,
}: {
  progress: SyncProgress | null
  result: SyncResult | null
  busy: boolean
}) {
  if (busy && progress) {
    const pct =
      progress.bytesTotal > 0 ? Math.round((progress.bytesDone / progress.bytesTotal) * 100) : 0
    return (
      <div className="status">
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="status-text">
          {progress.message}
          {progress.bytesTotal > 0 &&
            ` · ${formatBytes(progress.bytesDone)} de ${formatBytes(progress.bytesTotal)}`}
        </span>
      </div>
    )
  }

  if (!result) return null

  if (result.error) {
    return (
      <div className="status status-error">
        <strong>Falló la sincronización.</strong> {result.error}
      </div>
    )
  }

  return (
    <div className={result.ok ? 'status status-ok' : 'status status-warn'}>
      <span className="status-text">
        {result.from
          ? `${result.from} → ${result.to}: ${result.downloaded} archivos nuevos (${formatBytes(result.bytes)}), ${result.skipped} ya estaban.`
          : 'No había nada para sincronizar.'}
        {result.discarded > 0 && ` Se rehízo ${result.to} desde cero (${result.discarded} archivos).`}
        {result.failures.length > 0 && ` ${result.failures.length} fallaron.`}
      </span>
    </div>
  )
}
