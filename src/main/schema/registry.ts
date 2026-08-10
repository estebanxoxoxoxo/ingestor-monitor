/**
 * Catálogo DECLARADO de eventos: `schemas/<versión>/events_v<versión>.json`,
 * espejado en la caché por la sync de Bronze.
 *
 * Hace falta porque los datos no pueden responder la pregunta: `event` es un
 * STRING abierto y un `SELECT DISTINCT` dice qué ocurrió, nunca qué puede
 * ocurrir. La lista de eventos posibles vive en el código del SDK que los
 * emite, y este archivo es cómo ese código se la publica.
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
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { EventColumn, EventDefinition, EventGroup } from '@shared/types'

// ── Contrato del envelope: bronze_v<versión>.schema ────────────
// Es el esquema Parquet en texto:
//
//   message analytics_event_v1 {
//     optional binary message_id (STRING);
//     optional int64 received_at (TIMESTAMP(MICROS,true));
//   }
//
// Las columnas de la tabla NO se deducen mirando un Parquet de muestra: se
// leen de acá. Sniffear daría un set distinto según el archivo que toque.

const MESSAGE_RE = /^\s*message\s+(\S+)\s*\{/
const FIELD_RE = /^\s*(optional|required|repeated)\s+(\S+)\s+(\S+?)\s*(?:\((.+)\))?\s*;\s*$/

export interface ParsedSchema {
  messageName: string | null
  columns: EventColumn[]
}

export function parseSchema(text: string): ParsedSchema {
  let messageName: string | null = null
  const columns: EventColumn[] = []

  for (const line of text.split(/\r?\n/)) {
    if (!messageName) {
      const message = line.match(MESSAGE_RE)
      if (message) {
        messageName = message[1]
        continue
      }
    }
    const field = line.match(FIELD_RE)
    if (!field) continue
    columns.push({
      name: field[3],
      physicalType: field[2],
      logicalType: field[4] ?? null,
      optional: field[1] === 'optional',
    })
  }

  return { messageName, columns }
}

/** Ruta del contrato de una versión dentro de la caché. */
export function schemaFilePath(cacheDir: string, version: string): string {
  return join(cacheDir, 'schemas', version, `bronze_v${version}.schema`)
}

export async function readSchemaFile(
  cacheDir: string,
  version: string,
): Promise<ParsedSchema & { source: string }> {
  const source = schemaFilePath(cacheDir, version)
  const text = await readFile(source, 'utf8')
  return { ...parseSchema(text), source }
}

// ── Catálogo declarado de eventos ──────────────────────────────

export interface DeclaredEvents {
  events: EventDefinition[]
  groups: EventGroup[]
}

export async function readDeclaredEvents(cacheDir: string): Promise<DeclaredEvents | null> {
  const root = join(cacheDir, 'schemas')
  let versions: string[]
  try {
    versions = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return null // todavía no se espejó el registro (correr Bronze sync)
  }

  const byName = new Map<string, EventDefinition>()
  const groups = new Map<string, EventGroup>()

  for (const version of versions) {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(join(root, version, `events_v${version}.json`), 'utf8'))
    } catch {
      continue // esa versión no publicó catálogo
    }

    for (const block of blocksOf(parsed)) {
      groups.set(block.group.name, block.group)
      for (const item of block.items) {
        const definition = toDefinition(item, block.group.name)
        if (definition) byName.set(definition.name, definition)
      }
    }
  }

  // Un archivo presente pero sin grupos válidos es lo mismo que no tenerlo:
  // no se puede afirmar un catálogo con él.
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
