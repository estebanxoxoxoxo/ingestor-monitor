/**
 * Varias columnas del esquema son `binary (STRING)` con JSON adentro
 * (`context`, `properties`, `traits`, `integrations`). El contrato no las
 * distingue de un string común, así que se reconocen por el valor: si parsea
 * como objeto o array, la celda es expandible.
 */
export function parseJsonCell(value: unknown): unknown | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text.startsWith('{') && !text.startsWith('[')) return null
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

/** Resumen de una celda JSON para mostrar sin abrir el popup. */
export function summarizeJson(parsed: unknown): string {
  if (Array.isArray(parsed)) return `[ ${parsed.length} elementos ]`
  const keys = Object.keys(parsed as Record<string, unknown>)
  if (keys.length === 0) return '{ }'
  const preview = keys.slice(0, 3).join(', ')
  return `{ ${preview}${keys.length > 3 ? `, +${keys.length - 3}` : ''} }`
}
