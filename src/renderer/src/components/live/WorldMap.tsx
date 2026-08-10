import { useEffect, useMemo, useRef, useState } from 'react'
import { geoEquirectangular, geoPath } from 'd3-geo'
import { select } from 'd3-selection'
// Le agrega .transition() a las selecciones de d3-selection.
import 'd3-transition'
import { zoom as createZoom, zoomIdentity } from 'd3-zoom'
import type { ZoomBehavior, ZoomTransform } from 'd3-zoom'
import { feature } from 'topojson-client'
import type { LiveSession } from '@shared/types'
import { formatDuration } from '../../lib/format'
import worldAtlas from 'world-atlas/countries-110m.json'

/**
 * El planisferio va empaquetado en la app (TopoJSON de world-atlas) y se
 * proyecta con d3-geo. No hay tiles ni pedidos de red: la CSP del renderer no
 * permite salir a ningún lado, y además la app tiene que funcionar sin internet
 * salvo para la data.
 */
type Topology = Parameters<typeof feature>[0]
const topology = worldAtlas as unknown as Topology
const countries = feature(topology, topology.objects.countries as never) as unknown as {
  features: object[]
}

/** Proyección equirectangular: entra el planisferio entero y sin cortes. */
const ZOOM_RANGE: [number, number] = [1, 14]

interface Props {
  sessions: LiveSession[]
  hoveredId: string | null
  selectedId: string | null
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
}

export function WorldMap({ sessions, hoveredId, selectedId, onHover, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity)

  useEffect(() => {
    const element = wrapRef.current
    if (!element) return

    // Medición inmediata: el ResizeObserver sólo entrega durante un frame, y
    // si la ventana todavía no pintó, el mapa se quedaría sin dibujar.
    const measure = (): void => {
      const { width, height } = element.getBoundingClientRect()
      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      )
    }
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const { width, height } = size

  const geometry = useMemo(() => {
    if (width === 0 || height === 0) return null
    const projection = geoEquirectangular().fitSize([width, height], { type: 'Sphere' })
    const path = geoPath(projection)
    return {
      projection,
      sphere: path({ type: 'Sphere' }) ?? '',
      shapes: countries.features.map((f) => path(f as never) ?? ''),
    }
  }, [width, height])

  // Zoom y desplazamiento. El translateExtent evita que el mapa se pueda
  // arrastrar fuera de la vista y quede la pantalla vacía.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || width === 0) return
    const behavior = createZoom<SVGSVGElement, unknown>()
      .scaleExtent(ZOOM_RANGE)
      .translateExtent([
        [0, 0],
        [width, height],
      ])
      .on('zoom', (event: { transform: ZoomTransform }) => setTransform(event.transform))
    select(svg).call(behavior)
    zoomRef.current = behavior
    return () => {
      select(svg).on('.zoom', null)
    }
  }, [width, height])

  const scaleBy = (factor: number): void => {
    const svg = svgRef.current
    if (!svg || !zoomRef.current) return
    select(svg).transition().duration(220).call(zoomRef.current.scaleBy, factor)
  }

  const reset = (): void => {
    const svg = svgRef.current
    if (!svg || !zoomRef.current) return
    select(svg).transition().duration(300).call(zoomRef.current.transform, zoomIdentity)
  }

  /**
   * Un punto por sesión. Dos sesiones en la misma ciudad caen en la misma
   * coordenada, así que las repetidas se abren en espiral: siguen siendo
   * clickeables por separado, que es lo que hace que un punto sea una sesión.
   */
  const points = useMemo(() => {
    if (!geometry) return []
    const seen = new Map<string, number>()
    return sessions.flatMap((session) => {
      if (!session.located) return []
      const projected = geometry.projection([session.geo.lng as number, session.geo.lat as number])
      if (!projected) return []
      const key = `${session.geo.lat?.toFixed(2)},${session.geo.lng?.toFixed(2)}`
      const index = seen.get(key) ?? 0
      seen.set(key, index + 1)
      const angle = index * 2.399963 // ángulo áureo: reparte parejo
      const radius = index === 0 ? 0 : 7 + index * 1.8
      return [
        {
          session,
          x: projected[0] + Math.cos(angle) * radius,
          y: projected[1] + Math.sin(angle) * radius,
        },
      ]
    })
  }, [sessions, geometry])

  const hovered = points.find((p) => p.session.id === hoveredId) ?? null

  return (
    <div className="map-wrap" ref={wrapRef}>
      {geometry && (
        <svg ref={svgRef} width={width} height={height} className="map-svg">
          <defs>
            <radialGradient id="ocean-glow" cx="50%" cy="45%" r="70%">
              <stop offset="0%" stopColor="#16233a" />
              <stop offset="100%" stopColor="#0b1220" />
            </radialGradient>
          </defs>

          <rect width={width} height={height} fill="url(#ocean-glow)" />

          <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
            <path className="map-sphere" d={geometry.sphere} />
            {geometry.shapes.map((d, index) => (
              <path className="map-country" d={d} key={index} vectorEffect="non-scaling-stroke" />
            ))}
          </g>

          {/* Los puntos van fuera del grupo escalado para que su tamaño no
              dependa del zoom: se posicionan a mano con la misma transformada. */}
          <g className="map-dots">
            {points.map(({ session, x, y }) => {
              const screenX = x * transform.k + transform.x
              const screenY = y * transform.k + transform.y
              const state = [
                'map-dot',
                session.id === selectedId ? 'selected' : '',
                session.id === hoveredId ? 'hovered' : '',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <g
                  key={session.id}
                  className={state}
                  transform={`translate(${screenX},${screenY})`}
                  onMouseEnter={() => onHover(session.id)}
                  onMouseLeave={() => onHover(null)}
                  onClick={() => onSelect(session.id)}
                >
                  <circle className="dot-hit" r={12} />
                  <circle className="dot-ping" r={1.5} />
                  <circle className="dot-ring" r={5.5} />
                  <circle className="dot-core" r={1.5} />
                </g>
              )
            })}
          </g>
        </svg>
      )}

      {hovered && (
        <div
          className="map-tip"
          style={{
            left: hovered.x * transform.k + transform.x,
            top: hovered.y * transform.k + transform.y,
          }}
        >
          <strong>{hovered.session.geo.city ?? 'Sin ciudad'}</strong>
          <span>
            {hovered.session.geo.country} · {hovered.session.eventCount}{' '}
            {hovered.session.eventCount === 1 ? 'evento' : 'eventos'} ·{' '}
            {formatDuration(hovered.session.engagedTimeSec)}
          </span>
        </div>
      )}

      <div className="map-controls">
        <button onClick={() => scaleBy(1.6)} aria-label="Acercar">
          +
        </button>
        <button onClick={() => scaleBy(1 / 1.6)} aria-label="Alejar">
          −
        </button>
        <button className="map-reset" onClick={reset} aria-label="Ver todo el planisferio">
          ⤢
        </button>
      </div>

    </div>
  )
}
