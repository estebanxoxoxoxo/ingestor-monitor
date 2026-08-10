import { LAYERS } from '@shared/config'
import type { IngestStatus, PipelineLogEntry, StatusSnapshot } from '@shared/types'
import { formatBytes, formatUtcInstant, formatUtcTime } from '../lib/format'
import { useBilling } from '../hooks/useBilling'

/** 'YYYY-MM-DD HH:MM:SS UTC' — el feed merece segundos. */
const toSeconds = (iso: string | null): string =>
  iso ? `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC` : '—'

interface Props {
  /** El semáforo del ingestor. La suscripción vive en App. */
  ingest: IngestStatus | null
  /** El snapshot del vigía (feed + contadores). La suscripción vive en App. */
  snapshot: StatusSnapshot | null
}

/**
 * El tablero de guardia: el semáforo del ingestor y la facturación del mes
 * arriba y, abajo, el log del pipeline — un renglón por parquet que aterrizó
 * en el bucket, discriminando raw de bronze. El feed llega por suscripción a
 * Firestore: lo que se ve está pasando, y dos máquinas ven lo mismo.
 */
export function StatusView({ ingest, snapshot }: Props) {
  const { summary, loading, refresh } = useBilling()

  return (
    <main className="workspace ops-view">
      {/* ── Semáforo del ingestor ───────────────────────────── */}
      <section className="ops-panel">
        <p
          className="ingest-line"
          title={
            ingest?.state === 'up'
              ? `${ingest.target} · ${ingest.latencyMs} ms`
              : ingest?.state === 'down'
                ? `${ingest.target} · ${ingest.error ?? ''}`
                : undefined
          }
        >
          <span className={`ingest-dot ${ingest?.state ?? 'unknown'}`} aria-hidden="true" />
          {!ingest || ingest.state === 'unknown' ? (
            <>Ingestor: CHEQUEANDO…</>
          ) : (
            <>
              Ingestor: <strong>{ingest.state === 'up' ? 'ESCUCHANDO' : 'ERROR'}</strong> · Última
              actualización {formatUtcTime(ingest.checkedAt ?? '')}
            </>
          )}
        </p>
      </section>
      {/* ── Facturación AWS ─────────────────────────────────── */}
      <section className="ops-panel">
        <div className="billing-head">
          <div>
            <h2 className="ops-title">Facturación AWS · mes en curso</h2>
            <p className="billing-total">
              {summary?.total !== null && summary !== null
                ? `${summary.currency} ${summary.total.toFixed(2)}`
                : loading
                  ? 'Consultando…'
                  : '—'}
            </p>
            <p className="billing-window">
              {summary &&
                `Costo acumulado desde el ${summary.from} hasta hoy (${summary.to}, UTC)`}
              {summary?.fetchedAt && ` · consultado ${formatUtcInstant(summary.fetchedAt)}`}
            </p>
          </div>
          <button className="sync-button" onClick={refresh} disabled={loading}>
            {loading ? 'Consultando…' : 'Actualizar (US$ 0,01)'}
          </button>
        </div>

        {summary?.error && <p className="workspace-warning">{summary.error}</p>}

        {summary && summary.byService.length > 0 && (
          <table className="ops-table striped">
            <thead>
              <tr>
                <th>Servicio</th>
                <th className="ops-num">Costo</th>
              </tr>
            </thead>
            <tbody>
              {summary.byService.slice(0, 8).map((entry) => (
                <tr key={entry.service}>
                  <td>{entry.service}</td>
                  <td className="ops-num">
                    {summary.currency} {entry.amount.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Avisos del vigía ────────────────────────────────── */}
      {snapshot &&
        LAYERS.map((layer) => {
          const error = snapshot.layerErrors[layer]
          if (!error) return null
          return (
            <p key={layer} className="workspace-warning">
              El vigía no puede listar la capa <strong>{layer}</strong>
              {layer === 'raw' &&
                ' (el usuario IAM de sólo lectura necesita s3:ListBucket y s3:GetObject sobre ese prefijo)'}
              . Detalle: {error}
            </p>
          )
        })}

      {/* ── El log del pipeline ─────────────────────────────── */}
      <section className="ops-panel">
        <h2 className="ops-title">Ingestado · log</h2>
        {snapshot && snapshot.entries.length > 0 ? (
          <table className="ops-table striped">
            <thead>
              <tr>
                <th>Subido a S3</th>
                <th>Capa</th>
                <th>Archivo</th>
                <th>Tamaño</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.entries.map((entry: PipelineLogEntry) => (
                <tr key={entry.id}>
                  <td>{toSeconds(entry.lastModified)}</td>
                  <td>
                    <span className={`layer-badge ${entry.layer}`}>{entry.layer}</span>
                  </td>
                  <td className="ops-file" title={entry.key}>
                    {entry.file}
                  </td>
                  <td>{formatBytes(entry.size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="ops-empty">
            Sin batches hoy (UTC). El vigía lista el bucket cada minuto; lo anterior se mira
            en los espejos de Raw y Bronze.
          </p>
        )}
      </section>
    </main>
  )
}
