import { LAYERS } from '@shared/config'
import type { IngestStatus, StatusSnapshot } from '@shared/types'
import { formatBytes, formatUtcInstant, formatUtcTime } from '../lib/format'
import { useBilling } from '../hooks/useBilling'
import { useFirebaseUsage } from '../hooks/useFirebaseUsage'

const cantidad = (value: number | null): string =>
  value === null ? '—' : value.toLocaleString('es-AR')

const tamano = (value: number | null): string => (value === null ? '—' : formatBytes(value))

/**
 * La capa gratuita contra la que se mide cada métrica, en SUS unidades y
 * ventanas (pricing 2026): Firestore Standard 50k lecturas / 20k escrituras
 * / 20k borrados POR DÍA, 1 GiB almacenado total y 10 GiB de egreso POR
 * MES; RTDB 10 GB de bajada POR MES, 100 conexiones simultáneas y 1 GB
 * almacenado.
 */
const FREE_TIER = {
  reads: 50_000,
  writes: 20_000,
  deletes: 20_000,
  firestoreStorageBytes: 1024 ** 3, // 1 GiB
  rtdbDownloadedBytes: 10 * 1_000_000_000, // 10 GB/mes
  rtdbConnections: 100,
  rtdbStorageBytes: 1_000_000_000, // 1 GB
} as const

/** El % de la capa gratuita: amarillo si pasa de 75, rojo si pasa de 90. */
function Porcentaje({ value, limit }: { value: number | null; limit: number }) {
  if (value === null) return null
  const pct = (value / limit) * 100
  const color = pct > 90 ? 'var(--error)' : pct > 75 ? '#eab308' : undefined
  const text = pct < 10 ? pct.toFixed(1).replace('.', ',') : String(Math.round(pct))
  return <span style={color ? { color, fontWeight: 600 } : undefined}> ({text}%)</span>
}

interface Props {
  /** El semáforo del ingestor. La suscripción vive en App. */
  ingest: IngestStatus | null
  /** El snapshot del vigía (contadores y avisos). La suscripción vive en App. */
  snapshot: StatusSnapshot | null
}

/**
 * El tablero de guardia: el semáforo del ingestor, la facturación AWS del
 * mes y el uso de Firebase (Firestore + RTDB, vía Cloud Monitoring). El log
 * de ingestados vive en la pestaña de cada capa.
 */
export function StatusView({ ingest, snapshot }: Props) {
  const { summary, loading, refresh } = useBilling()
  const firebase = useFirebaseUsage()

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
            </p>
            {summary?.fetchedAt && (
              <p className="billing-window">
                Actualizado: {formatUtcInstant(summary.fetchedAt)}
              </p>
            )}
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

      {/* ── Uso de Firebase ─────────────────────────────────── */}
      <section className="ops-panel">
        <div className="billing-head">
          <div>
            <h2 className="ops-title">Firebase · uso de hoy (UTC)</h2>
            {firebase.usage?.fetchedAt && (
              <p className="billing-window">
                Actualizado: {formatUtcInstant(firebase.usage.fetchedAt)}
              </p>
            )}
          </div>
          <button
            className="sync-button"
            onClick={firebase.refresh}
            disabled={firebase.loading}
          >
            {firebase.loading ? 'Consultando…' : 'Actualizar'}
          </button>
        </div>

        {firebase.usage?.error && (
          <p className="workspace-warning">{firebase.usage.error}</p>
        )}

        {firebase.usage && (
          <table className="ops-table striped">
            <thead>
              <tr>
                <th>Métrica</th>
                <th className="ops-num">Valor</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Firestore · lecturas hoy</td>
                <td className="ops-num" title="Gratis: 50.000 por día">
                  {cantidad(firebase.usage.reads)}
                  <Porcentaje value={firebase.usage.reads} limit={FREE_TIER.reads} />
                </td>
              </tr>
              <tr>
                <td>Firestore · escrituras hoy</td>
                <td className="ops-num" title="Gratis: 20.000 por día">
                  {cantidad(firebase.usage.writes)}
                  <Porcentaje value={firebase.usage.writes} limit={FREE_TIER.writes} />
                </td>
              </tr>
              <tr>
                <td>Firestore · borrados hoy</td>
                <td className="ops-num" title="Gratis: 20.000 por día">
                  {cantidad(firebase.usage.deletes)}
                  <Porcentaje value={firebase.usage.deletes} limit={FREE_TIER.deletes} />
                </td>
              </tr>
              <tr>
                <td>Firestore · almacenado</td>
                <td className="ops-num" title="Documentos + índices. Gratis: 1 GiB total">
                  {tamano(firebase.usage.firestoreStorageBytes)}
                  <Porcentaje
                    value={firebase.usage.firestoreStorageBytes}
                    limit={FREE_TIER.firestoreStorageBytes}
                  />
                </td>
              </tr>
              <tr>
                <td>Realtime DB · bajado del mes</td>
                <td className="ops-num" title="Gratis: 10 GB por mes">
                  {tamano(firebase.usage.rtdbDownloadedBytes)}
                  <Porcentaje
                    value={firebase.usage.rtdbDownloadedBytes}
                    limit={FREE_TIER.rtdbDownloadedBytes}
                  />
                </td>
              </tr>
              <tr>
                <td>Realtime DB · conexiones ahora</td>
                <td
                  className="ops-num"
                  title="Incluye la conexión de esta app (Vivo mantiene su propio websocket). Gratis: 100 simultáneas"
                >
                  {cantidad(firebase.usage.rtdbActiveConnections)}
                  <Porcentaje
                    value={firebase.usage.rtdbActiveConnections}
                    limit={FREE_TIER.rtdbConnections}
                  />
                </td>
              </tr>
              <tr>
                <td>Realtime DB · almacenado</td>
                <td className="ops-num" title="Gratis: 1 GB">
                  {tamano(firebase.usage.rtdbStorageBytes)}
                  <Porcentaje
                    value={firebase.usage.rtdbStorageBytes}
                    limit={FREE_TIER.rtdbStorageBytes}
                  />
                </td>
              </tr>
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

    </main>
  )
}
