import { useMemo, useState } from 'react'
import type { EventDefinition, EventGroup, LiveSnapshot } from '@shared/types'
import { useRelevantEvents } from '../../hooks/useRelevantEvents'
import { RelevantEventsModal } from './RelevantEventsModal'

/**
 * Columnas de la zona de relevantes. No sale del registro porque no es un dato
 * del negocio: es cuánto espacio le damos en la barra.
 */
const RELEVANT_COLUMNS = 5

/**
 * Ancho mínimo por columna. Sin este piso, en una ventana angosta las columnas
 * se reparten un espacio que no alcanza y los cuadros quedan ilegibles; con él,
 * la banda scrollea en horizontal y los cuadros conservan su tamaño.
 */
const MIN_COLUMN_PX = 76
const ZONE_PADDING_PX = 36

const zoneStyle = (columns: number): { flexGrow: number; minWidth: number } => ({
  flexGrow: columns,
  minWidth: columns * MIN_COLUMN_PX + ZONE_PADDING_PX,
})

interface Props {
  snapshot: LiveSnapshot | null
  /** Los eventos que existen, según el registro. */
  catalog: EventDefinition[]
  /** Los grupos que declara el registro, en su orden. */
  groups: EventGroup[]
  /** false = la lista se dedujo de los datos, no está declarada. */
  declared: boolean
}

/**
 * Una sola banda horizontal. Cada zona tiene su ancho reservado, así los
 * números y los cuadros nunca se corren de lugar cuando cambian los valores.
 */
export function LiveHeader({ snapshot, catalog, groups, declared }: Props) {
  const sessions = snapshot?.sessions ?? []
  const { relevant, loading, error, save } = useRelevantEvents()
  const [picking, setPicking] = useState(false)

  /**
   * El catálogo declarado, más lo que esté llegando en vivo con un nombre que
   * no figura en él. Eso último no debería pasar: si aparece, es un evento que
   * el SDK emite y el registro no declara.
   */
  const definitions = useMemo(() => {
    const map = new Map<string, EventDefinition>(catalog.map((e) => [e.name, e]))
    const unknown = (name: string): EventDefinition => ({
      name,
      label: name,
      group: null,
      values: [],
    })
    for (const { name } of snapshot?.eventTotals ?? []) {
      if (!map.has(name)) map.set(name, unknown(name))
    }
    for (const name of relevant) if (!map.has(name)) map.set(name, unknown(name))
    return map
  }, [catalog, snapshot, relevant])

  const counts = useMemo(() => {
    const map = new Map<string, number>([...definitions.keys()].map((name) => [name, 0]))
    for (const { name, count } of snapshot?.eventTotals ?? []) {
      map.set(name, (map.get(name) ?? 0) + count)
    }
    return map
  }, [definitions, snapshot])

  /**
   * Orden alfabético fijo a propósito: si se ordenara por cantidad, los cuadros
   * saltarían de lugar cada vez que entra un evento.
   */
  const all = useMemo(
    () => [...definitions.values()].sort((a, b) => a.label.localeCompare(b.label)),
    [definitions],
  )

  // Lo que no pertenece a ningún grupo declarado necesita su propio lugar; si
  // no, un evento que llega en vivo y el registro no declara desaparecería.
  const known = new Set(groups.map((group) => group.name))
  const ungrouped = all.filter((event) => !event.group || !known.has(event.group))

  const relevantTotal = relevant.reduce((acc, name) => acc + (counts.get(name) ?? 0), 0)
  const totalEvents = snapshot?.totalEvents ?? 0
  const relevantShare = totalEvents > 0 ? Math.round((relevantTotal / totalEvents) * 100) : 0

  return (
    <header className="live-header">
      <section className="live-zone zone-hero">
        <span className="zone-title">
          <span className="live-pulse" aria-hidden="true" />
          Sesiones ahora
        </span>
        <span className="live-hero-value">{sessions.length}</span>
      </section>

      <section className="live-zone zone-stats">
        <dl className="live-stats">
          <Stat label="Conexiones" value={snapshot?.connections ?? 0} />
          <Stat label="Eventos" value={totalEvents} />
          <Stat
            label="Eventos relevantes"
            value={relevantTotal}
            suffix={`${relevantShare}%`}
            title={`Suma de los eventos elegidos sobre todas las sesiones abiertas. El porcentaje es contra los ${totalEvents} eventos totales.`}
            accent
          />
        </dl>
      </section>

      {/*
        Un contenedor por grupo declarado, en el orden del archivo y con su
        label. La app no conoce ningún grupo por nombre. Lo que no viene
        agrupado —o toda la lista, si se dedujo de los datos— cae en un
        contenedor propio.
      */}
      {groups.map((group) => (
        <EventZone
          key={group.name}
          title={group.label}
          columns={group.columns}
          events={all.filter((event) => event.group === group.name)}
          counts={counts}
          sessions={sessions.length}
        />
      ))}

      {ungrouped.length > 0 && (
        <EventZone
          title={groups.length > 0 ? 'Sin grupo' : 'Todos los eventos'}
          columns={Math.max(1, Math.ceil(ungrouped.length / 3))}
          events={ungrouped}
          counts={counts}
          sessions={sessions.length}
          warning={
            declared
              ? undefined
              : 'El registro no publica events_v<version>.json, así que esta lista sale de lo que ocurrió en la caché y no de lo que el SDK puede emitir'
          }
        />
      )}

      {/*
        Entra en el mismo reparto que las zonas de grupo: ancho proporcional a
        sus columnas y grilla de esas columnas, así el cuadro mide igual acá
        que allá.
      */}
      <section className="live-zone zone-relevant" style={zoneStyle(RELEVANT_COLUMNS)}>
        <span className="zone-title">
          Eventos relevantes
          <button className="zone-config" onClick={() => setPicking(true)} title="Elegir y ordenar">
            Elegir
          </button>
        </span>
        <div
          className="live-events"
          role="list"
          style={{ gridTemplateColumns: `repeat(${RELEVANT_COLUMNS}, minmax(0, 1fr))` }}
        >
          {relevant.map((name) => (
            <EventBox
              key={name}
              event={definitions.get(name) ?? { name, label: name, group: null, values: [] }}
              count={counts.get(name) ?? 0}
              sessions={sessions.length}
            />
          ))}
          {error && <span className="zone-error">{error}</span>}
          {!error && relevant.length === 0 && (
            <span className="zone-hint">
              {loading ? 'Leyendo la elección guardada…' : 'Ninguno elegido todavía.'}
            </span>
          )}
        </div>
      </section>

      <RelevantEventsModal
        open={picking}
        available={all}
        selected={relevant}
        onSave={(names) => void save(names)}
        onClose={() => setPicking(false)}
      />
    </header>
  )
}

function EventZone({
  title,
  columns,
  events,
  counts,
  sessions,
  warning,
}: {
  title: string
  columns: number
  events: EventDefinition[]
  counts: Map<string, number>
  sessions: number
  warning?: string
}) {
  return (
    /*
     * El ancho de la zona crece con su cantidad de columnas, y adentro la
     * grilla usa exactamente esas columnas. Así el cuadro mide lo mismo en
     * todas las zonas —el ancho por columna queda igual— y cada grupo entra
     * de a la cantidad que declaró.
     */
    <section className="live-zone zone-group" style={zoneStyle(columns)}>
      <span className="zone-title">
        {title}
        <span className="zone-count">{events.length}</span>
        {warning && (
          <em className="zone-warning" title={warning}>
            deducidos
          </em>
        )}
      </span>
      <div
        className="live-events"
        role="list"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {events.map((event) => (
          <EventBox
            key={event.name}
            event={event}
            count={counts.get(event.name) ?? 0}
            sessions={sessions}
          />
        ))}
      </div>
    </section>
  )
}

/**
 * El número es el PROMEDIO por sesión abierta, no el total. Un total crudo
 * sube solo porque hay más gente; el promedio dice cuánto hace cada uno.
 * El total queda en el tooltip para no perder la magnitud.
 */
function EventBox({
  event,
  count,
  sessions,
}: {
  event: EventDefinition
  count: number
  sessions: number
}) {
  return (
    <span
      className={count > 0 ? 'live-event active' : 'live-event'}
      role="listitem"
      title={`${event.name} · ${count} en ${sessions} ${sessions === 1 ? 'sesión' : 'sesiones'}`}
    >
      <span className="live-event-name">{event.label}</span>
      <span className="live-event-count">{perSession(count, sessions)}</span>
    </span>
  )
}

/** Sin decimales cuando da redondo; con uno cuando no. */
function perSession(count: number, sessions: number): string {
  if (sessions === 0 || count === 0) return '0'
  const average = count / sessions
  return Number.isInteger(average) ? String(average) : average.toFixed(1)
}

function Stat({
  label,
  value,
  suffix,
  title,
  accent,
}: {
  label: string
  value: number | string
  suffix?: string
  title?: string
  accent?: boolean
}) {
  return (
    <div className="live-stat" title={title}>
      <dt>{label}</dt>
      <dd className={accent ? 'accent' : undefined}>
        {value}
        {suffix && <span className="stat-suffix">{suffix}</span>}
      </dd>
    </div>
  )
}
