export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

/** Las horas de la UI llevan sufijo UTC porque el análisis no convierte husos. */
export function formatUtcInstant(iso: string): string {
  const d = new Date(iso)
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`
}

export function formatUtcTime(iso: string): string {
  return `${new Date(iso).toISOString().slice(11, 19)} UTC`
}

/** 'YYYY-MM-DD HH:MM:SS UTC': para archivos, los segundos importan. */
export function formatUtcStamp(iso: string): string {
  const text = new Date(iso).toISOString()
  return `${text.slice(0, 10)} ${text.slice(11, 19)} UTC`
}

/**
 * Segundos transcurridos desde un instante ISO hasta AHORA. Se recalcula en
 * cada render, así que con el ticker de un segundo el número sube solo — a
 * diferencia del tiempo comprometido, que sólo avanza cuando llega un evento.
 * 0 si no hay fecha, o si viene del futuro (reloj del cliente adelantado).
 */
export function secondsSince(iso: string | null): number {
  if (!iso) return 0
  const seconds = (Date.now() - Date.parse(iso)) / 1000
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
}

/** Duración compacta: 45s, 12m 30s, 1h 04m. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}m ${String(total % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/** Cuánto hace que pasó algo, respecto de ahora. */
export function formatAgo(iso: string | null): string {
  if (!iso) return '—'
  const seconds = (Date.now() - Date.parse(iso)) / 1000
  if (seconds < 5) return 'ahora'
  if (seconds < 60) return `hace ${Math.round(seconds)}s`
  if (seconds < 3600) return `hace ${Math.round(seconds / 60)}m`
  return `hace ${Math.round(seconds / 3600)}h`
}
