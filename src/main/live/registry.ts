/**
 * Catálogo DECLARADO de eventos: `schemas/event-types.json` del lake, que
 * la suite publica desde sus enums (behavior + business) con
 * `npm run publish:event-types` en el repo `events-suite`.
 *
 * Hace falta porque los datos no pueden responder la pregunta: `event` es un
 * STRING abierto y un `SELECT DISTINCT` dice qué ocurrió, nunca qué puede
 * ocurrir. La lista de eventos posibles vive en el código de la suite que
 * los emite, y ese archivo es cómo el código se la publica al resto.
 *
 * Un solo formato, que es el que se publica:
 *
 *   {
 *     "groups": [
 *       { "name": "behavior", "label": "Behavior", "columns": 5,
 *         "events": [{ "name": "depth_scroll", "label": "Scroll depth" }] }
 *     ]
 *   }
 *
 * La app no conoce ningún grupo por nombre: dibuja un contenedor por cada uno
 * de los que vengan, con su label y sus columnas, en el orden del archivo.
 * `label` y `columns` son opcionales.
 *
 * Cualquier otra forma se ignora. Soportar formatos que nadie publica es
 * código sin ejercitar que promete algo no comprobado.
 */
import type { EventDefinition, EventGroup } from '@shared/types'

export interface DeclaredEvents {
  events: EventDefinition[]
  groups: EventGroup[]
}

/**
 * Une los catálogos de todas las versiones publicadas (los JSON ya
 * parseados). Pura: quien la llama decide de dónde vienen los archivos.
 */
export function declaredEventsOf(parsedFiles: unknown[]): DeclaredEvents | null {
  const byName = new Map<string, EventDefinition>()
  const groups = new Map<string, EventGroup>()

  for (const parsed of parsedFiles) {
    for (const block of blocksOf(parsed)) {
      groups.set(block.group.name, block.group)
      for (const item of block.items) {
        const definition = toDefinition(item, block.group.name)
        if (definition) byName.set(definition.name, definition)
      }
    }
  }

  // Archivos presentes pero sin grupos válidos es lo mismo que no tenerlos:
  // no se puede afirmar un catálogo con eso.
  if (groups.size === 0) return null
  return {
    events: [...byName.values()].sort((a, b) => a.label.localeCompare(b.label)),
    groups: [...groups.values()],
  }
}

interface Block {
  group: EventGroup
  items: unknown[]
}

/** Los grupos del archivo. Sin `groups` válido, no hay catálogo declarado. */
function blocksOf(parsed: unknown): Block[] {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  const groups = (parsed as { groups?: unknown }).groups
  if (!Array.isArray(groups)) return []

  return groups.flatMap((raw): Block[] => {
    if (!raw || typeof raw !== 'object') return []
    const entry = raw as { name?: unknown; label?: unknown; columns?: unknown; events?: unknown }
    if (typeof entry.name !== 'string' || !entry.name) return []
    const items = Array.isArray(entry.events) ? entry.events : []
    return [
      {
        group: {
          name: entry.name,
          label: typeof entry.label === 'string' && entry.label ? entry.label : titleize(entry.name),
          columns: columnsOf(entry.columns, items.length),
        },
        items,
      },
    ]
  })
}

/** Sin declaración, se apunta a tres filas: es lo que entra sin estirar la banda. */
function columnsOf(declared: unknown, total: number): number {
  if (typeof declared === 'number' && Number.isInteger(declared) && declared > 0) return declared
  return Math.max(1, Math.ceil(total / 3))
}

const titleize = (value: string): string =>
  value.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase())

function toDefinition(item: unknown, group: string): EventDefinition | null {
  if (!item || typeof item !== 'object') return null
  const entry = item as { name?: unknown; label?: unknown; values?: unknown }
  if (typeof entry.name !== 'string' || !entry.name) return null
  return {
    name: entry.name,
    label: typeof entry.label === 'string' && entry.label ? entry.label : entry.name,
    group,
    values: Array.isArray(entry.values)
      ? [...new Set(entry.values.filter((v): v is string => typeof v === 'string' && v !== ''))]
      : [],
  }
}
