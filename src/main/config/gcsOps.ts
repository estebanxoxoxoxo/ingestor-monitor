/**
 * La clase de facturación de las operaciones de GCS, por el verbo del
 * método tal como lo reporta `storage.googleapis.com/api/request_count` —
 * así las agrupa la página de pricing:
 *
 *  - clase B: las lecturas — `Get*` (metadatos, IAM, layout), `Read*`
 *    (bajar un objeto) y `Test*`.
 *  - gratis: los borrados (`Delete*`) y las cancelaciones (`Cancel*`).
 *  - clase A: TODO el resto — escrituras, listados, updates, rewrites,
 *    SetIamPolicy. Un método no reconocido cae acá a propósito: cota
 *    superior antes que un "gratis" inventado.
 *
 * `RewriteObject.From` se descarta: la métrica reporta un rewrite desde
 * los dos lados (origen y destino) y la operación facturable es UNA — se
 * cuenta por `RewriteObject.To`.
 */
export function gcsOpClass(method: string): 'a' | 'b' | 'skip' {
  if (method === 'RewriteObject.From') return 'skip'
  if (/^(Get|Read|Test)/.test(method)) return 'b'
  if (/^(Delete|Cancel)/.test(method)) return 'skip'
  return 'a'
}

/** Suma un mapa método→cantidad en los dos contadores facturables. */
export function gcsOpsByClass(byMethod: Map<string, number>): { a: number; b: number } {
  let a = 0
  let b = 0
  for (const [method, count] of byMethod) {
    const clase = gcsOpClass(method)
    if (clase === 'a') a += count
    else if (clase === 'b') b += count
  }
  return { a, b }
}
