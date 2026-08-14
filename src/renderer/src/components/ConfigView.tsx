import { useState } from 'react'
import { LAYERS } from '@shared/config'
import type { LayerId } from '@shared/config'
import type { IngestStatus, StatusSnapshot } from '@shared/types'
import { formatBytes, formatUtcInstant, formatUtcTime } from '../lib/format'
import { useFirebaseUsage } from '../hooks/useFirebaseUsage'
import { useGcpUsage } from '../hooks/useGcpUsage'

const cantidad = (value: number | null): string =>
  value === null ? '—' : value.toLocaleString('es-AR')

const tamano = (value: number | null): string => (value === null ? '—' : formatBytes(value))

const GIB = 1024 ** 3

/**
 * La capa gratuita contra la que se mide cada métrica, en SUS unidades y
 * ventanas (verificadas contra el catálogo de Cloud Billing, 2026-08):
 * Firestore Standard 50k lecturas / 20k escrituras / 20k borrados POR DÍA
 * y 1 GiB almacenado; RTDB 10 GB de bajada POR MES y 1 GiB almacenado; las
 * conexiones no se facturan en Blaze — el 100 es el techo del plan gratuito
 * y se deja como referencia de escala.
 */
const FREE_TIER = {
  reads: 50_000,
  writes: 20_000,
  deletes: 20_000,
  firestoreStorageBytes: GIB, // 1 GiB
  rtdbDownloadedBytes: 10 * 1_000_000_000, // 10 GB/mes
  rtdbConnections: 100,
  rtdbStorageBytes: GIB, // 1 GiB
} as const

/**
 * Always Free de Google Cloud, en SUS unidades y ventanas (los cupos con
 * franquicia embebida salen del catálogo de Cloud Billing, 2026-08): GCS
 * 5 GiB-mes de almacenamiento regional US, 5.000 operaciones clase A y
 * 50.000 clase B POR MES, 100 GB de salida POR MES; VM e2-micro 1 GB de
 * salida POR MES (sin China/Australia); funciones 2 millones de
 * ejecuciones POR MES; Pub/Sub 10 GiB de mensajes POR MES; Artifact
 * Registry 0,5 GiB almacenados.
 */
const FREE_TIER_GC = {
  lakeStorageBytes: 5 * GIB, // 5 GiB
  gcsClassAOps: 5_000,
  gcsClassBOps: 50_000,
  gcsSentBytes: 100 * 1_000_000_000, // 100 GB/mes
  vmSentBytes: 1_000_000_000, // 1 GB/mes
  functionInvocations: 2_000_000,
  pubsubBytes: 10 * GIB, // 10 GiB/mes
  artifactStorageBytes: GIB / 2, // 0,5 GiB
} as const

// Los DÓLARES no se calculan acá: el gasto real sale del export de
// facturación (tarjeta "Cuenta de Google"), leído de origen. Estas capas
// gratuitas sólo dan el % de orientación de cada métrica.

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
 * La pestaña Config — el tablero de guardia y de operación: el semáforo
 * del ingestor, los accesos a las consolas de facturación (GC) y uso
 * (Firebase) — se abren en el navegador porque Google no permite
 * embeberlas —, el Full sync del índice por capa (la curación manual), y
 * el uso de Firebase (Firestore + RTDB) y de Google Cloud (GCS, VM,
 * función, Pub/Sub) vía Cloud Monitoring. El log de ingestados vive en la
 * pestaña de cada capa.
 */
export function ConfigView({ ingest, snapshot }: Props) {
  const firebase = useFirebaseUsage()
  const gcp = useGcpUsage()

  // Full sync por capa: la única operación que toca el bucket entero. El
  // resultado queda a la vista; las pestañas Raw/Bronze releen el índice
  // reparado al entrar.
  const [syncing, setSyncing] = useState<Record<LayerId, boolean>>({
    raw: false,
    bronze: false,
  })
  const [synced, setSynced] = useState<Record<LayerId, string | null>>({
    raw: null,
    bronze: null,
  })

  const fullSync = async (layer: LayerId): Promise<void> => {
    setSyncing((prev) => ({ ...prev, [layer]: true }))
    try {
      const state = await window.api.relistLayer(layer)
      setSynced((prev) => ({
        ...prev,
        [layer]: state.error
          ? state.error
          : `Reconciliado: ${state.files} archivos · ${formatBytes(state.bytes)} · ${formatUtcTime(
              state.listedAt ?? '',
            )} UTC`,
      }))
    } finally {
      setSyncing((prev) => ({ ...prev, [layer]: false }))
    }
  }

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
      {/* ── Consolas (se abren en el navegador) ─────────────── */}
      <section className="ops-panel">
        <div className="billing-head">
          <div>
            <h2 className="ops-title">Facturación y uso · consolas</h2>
          </div>
          <div className="billing-actions">
            <button
              className="sync-button"
              onClick={() => void window.api.openBillingReport()}
              title="Informe de facturación de la cuenta completa (todos los proyectos)"
            >
              GC · facturación ↗
            </button>
            <button
              className="sync-button"
              onClick={() => void window.api.openFirebaseUsage()}
              title="Panel de uso del proyecto en la consola de Firebase"
            >
              Firebase · uso ↗
            </button>
          </div>
        </div>
      </section>

      {/* ── Full sync del índice ────────────────────────────── */}
      <section className="ops-panel">
        <h2 className="ops-title">Índice del lake · Full sync</h2>
        <table className="ops-table striped">
          <thead>
            <tr>
              <th>Capa</th>
              <th>Último resultado</th>
              <th className="ops-num" aria-label="acción" />
            </tr>
          </thead>
          <tbody>
            {LAYERS.map((layer) => (
              <tr key={layer}>
                <td>
                  <span className={`layer-badge ${layer}`}>{layer}</span>
                </td>
                <td>{synced[layer] ?? '—'}</td>
                <td className="ops-num">
                  <button
                    className="sync-button"
                    onClick={() => void fullSync(layer)}
                    disabled={syncing[layer]}
                    title="Relista TODO el bucket y reconcilia el índice en Firestore"
                  >
                    <span
                      className={syncing[layer] ? 'sync-icon spinning' : 'sync-icon'}
                      aria-hidden="true"
                    >
                      ⟳
                    </span>
                    {syncing[layer] ? 'Sincronizando…' : 'Full sync'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── Uso de Firebase ─────────────────────────────────── */}
      <section className="ops-panel">
        <div className="billing-head">
          <div>
            <h2 className="ops-title">Firebase · uso</h2>
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
                  title="Incluye la conexión de esta app (Vivo mantiene su propio websocket). Referencia: 100 (techo del plan gratuito; en Blaze no se facturan)"
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
                <td className="ops-num" title="Gratis: 1 GiB">
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

      {/* ── Uso de Google Cloud ─────────────────────────────── */}
      <section className="ops-panel">
        <div className="billing-head">
          <div>
            <h2 className="ops-title">Google Cloud · uso</h2>
            {gcp.usage?.fetchedAt && (
              <p className="billing-window">
                Actualizado: {formatUtcInstant(gcp.usage.fetchedAt)}
              </p>
            )}
          </div>
          <button className="sync-button" onClick={gcp.refresh} disabled={gcp.loading}>
            {gcp.loading ? 'Consultando…' : 'Actualizar'}
          </button>
        </div>

        {gcp.usage?.error && <p className="workspace-warning">{gcp.usage.error}</p>}

        {gcp.usage && (
          <table className="ops-table striped">
            <thead>
              <tr>
                <th>Métrica</th>
                <th className="ops-num">Valor</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Lake · almacenado</td>
                <td
                  className="ops-num"
                  title="raw + bronze según el índice de Firestore. Gratis: 5 GiB-mes regional (regiones US)"
                >
                  {tamano(gcp.usage.lakeStorageBytes)}
                  <Porcentaje
                    value={gcp.usage.lakeStorageBytes}
                    limit={FREE_TIER_GC.lakeStorageBytes}
                  />
                </td>
              </tr>
              <tr>
                <td>GCS · operaciones clase A del mes</td>
                <td
                  className="ops-num"
                  title="Escrituras y listados, todos los buckets del proyecto, errores incluidos. Gratis: 5.000 por mes"
                >
                  {cantidad(gcp.usage.gcsClassAOps)}
                  <Porcentaje value={gcp.usage.gcsClassAOps} limit={FREE_TIER_GC.gcsClassAOps} />
                </td>
              </tr>
              <tr>
                <td>GCS · operaciones clase B del mes</td>
                <td
                  className="ops-num"
                  title="Lecturas de objetos y metadatos. Gratis: 50.000 por mes"
                >
                  {cantidad(gcp.usage.gcsClassBOps)}
                  <Porcentaje value={gcp.usage.gcsClassBOps} limit={FREE_TIER_GC.gcsClassBOps} />
                </td>
              </tr>
              <tr>
                <td>GCS · servido del mes</td>
                <td
                  className="ops-num"
                  title="Bytes que GCS respondió a cualquier destino (viewer, full sync, la VM): cota superior del egreso. Gratis: 100 GB por mes"
                >
                  {tamano(gcp.usage.gcsSentBytes)}
                  <Porcentaje value={gcp.usage.gcsSentBytes} limit={FREE_TIER_GC.gcsSentBytes} />
                </td>
              </tr>
              <tr>
                <td>VM · salida de red del mes</td>
                <td
                  className="ops-num"
                  title="Todo destino; las subidas al lake quedan dentro de Google y no computan al cupo: cota superior. Gratis: 1 GB por mes"
                >
                  {tamano(gcp.usage.vmSentBytes)}
                  <Porcentaje value={gcp.usage.vmSentBytes} limit={FREE_TIER_GC.vmSentBytes} />
                </td>
              </tr>
              <tr>
                <td>Función índice · ejecuciones del mes</td>
                <td
                  className="ops-num"
                  title="index-writer: una por archivo que aterriza en el lake. Gratis: 2.000.000 por mes"
                >
                  {cantidad(gcp.usage.functionInvocations)}
                  <Porcentaje
                    value={gcp.usage.functionInvocations}
                    limit={FREE_TIER_GC.functionInvocations}
                  />
                </td>
              </tr>
              <tr>
                <td>Pub/Sub · mensajes del mes</td>
                <td
                  className="ops-num"
                  title="Bytes tasados de publicación y entrega (las notificaciones del bucket). Gratis: 10 GiB por mes"
                >
                  {tamano(gcp.usage.pubsubBytes)}
                  <Porcentaje value={gcp.usage.pubsubBytes} limit={FREE_TIER_GC.pubsubBytes} />
                </td>
              </tr>
              <tr>
                <td>Artifact Registry · almacenado</td>
                <td
                  className="ops-num"
                  title="Las imágenes que Cloud Build arma al desplegar la función. Gratis: 0,5 GiB"
                >
                  {tamano(gcp.usage.artifactStorageBytes)}
                  <Porcentaje
                    value={gcp.usage.artifactStorageBytes}
                    limit={FREE_TIER_GC.artifactStorageBytes}
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
              El vigía no puede leer la capa <strong>{layer}</strong>. Detalle: {error}
            </p>
          )
        })}

    </main>
  )
}
