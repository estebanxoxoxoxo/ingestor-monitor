import { useEffect, useMemo, useRef, useState } from 'react'
import { geoEquirectangular, geoPath } from 'd3-geo'
import { select } from 'd3-selection'
// Le agrega .transition() a las selecciones de d3-selection.
import 'd3-transition'
import { zoom as createZoom, zoomIdentity } from 'd3-zoom'
import type { ZoomBehavior, ZoomTransform } from 'd3-zoom'
import { feature } from 'topojson-client'
import type { LiveTab } from '@shared/types'
import { formatDuration, secondsSince } from '../../lib/format'
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
  tabs: LiveTab[]
  hoveredId: string | null
  selectedId: string | null
  onHover: (id: string | null) => void
  /** null = se deseleccionó (click en el mapa, fuera de todo punto). */
  onSelect: (id: string | null) => void
}

export function WorldMap({ tabs, hoveredId, selectedId, onHover, onSelect }: Props) {
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
   * Un punto por pestaña, SIEMPRE en su coordenada real: desplazarlos para que
   * no se tapen mentiría sobre dónde está cada uno. Las de la misma ciudad se
   * superponen y se ven como uno solo.
   */
  const points = useMemo(() => {
    if (!geometry) return []
    return tabs.flatMap((tab) => {
      if (!tab.located) return []
      const projected = geometry.projection([tab.geo.lng as number, tab.geo.lat as number])
      if (!projected) return []
      return [{ tab, x: projected[0], y: projected[1] }]
    })
  }, [tabs, geometry])

  const hovered = points.find((p) => p.tab.id === hoveredId) ?? null

  /**
   * Apilados, el último que se dibuja es el que se ve y el que recibe el
   * click: el elegido y el apuntado van al final para no quedar debajo.
   */
  const drawOrder = useMemo(() => {
    const depth = (id: string): number => (id === selectedId ? 2 : id === hoveredId ? 1 : 0)
    return [...points].sort((a, b) => depth(a.tab.id) - depth(b.tab.id))
  }, [points, hoveredId, selectedId])

  return (
    <div className="map-wrap" ref={wrapRef}>
      {/* El onClick del svg deselecciona: cualquier click que no sea sobre un
          punto (los puntos cortan la propagación). Arrastrar para desplazar no
          cuenta — d3-zoom suprime el click que sigue a un arrastre. */}
      {geometry && (
        <svg
          ref={svgRef}
          width={width}
          height={height}
          className="map-svg"
          onClick={() => onSelect(null)}
        >
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
            {drawOrder.map(({ tab, x, y }) => {
              const screenX = x * transform.k + transform.x
              const screenY = y * transform.k + transform.y
              const state = [
                'map-dot',
                tab.id === selectedId ? 'selected' : '',
                tab.id === hoveredId ? 'hovered' : '',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <g
                  key={tab.id}
                  className={state}
                  transform={`translate(${screenX},${screenY})`}
                  onMouseEnter={() => onHover(tab.id)}
                  onMouseLeave={() => onHover(null)}
                  onClick={(event) => {
                    event.stopPropagation()
                    onSelect(tab.id)
                  }}
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
          <strong>{hovered.tab.geo.city ?? 'Sin ciudad'}</strong>
          <span>
            {hovered.tab.geo.country} · {hovered.tab.eventCount}{' '}
            {hovered.tab.eventCount === 1 ? 'evento' : 'eventos'} ·{' '}
            {formatDuration(secondsSince(hovered.tab.startedAt))}
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
