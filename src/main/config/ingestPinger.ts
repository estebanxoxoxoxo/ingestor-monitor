import { Socket } from 'node:net'
import { PING_INTERVAL_MS, PING_TIMEOUT_MS } from '@shared/config'
import type { IngestStatus } from '@shared/types'
import { loadEnv } from '../env'

export type IngestListener = (status: IngestStatus) => void

/**
 * El semáforo del ingestor: cada 5 minutos un probe TCP al host:puerto del
 * ingest. Si el socket CONECTA, hay instancia levantada y proceso escuchando
 * — la definición pedida de "funciona". No manda ni un byte de datos: abre,
 * mide y cierra.
 *
 * Honestidad del semáforo: el probe sale de esta máquina, así que un rojo
 * también puede ser la red local caída. Y "escuchando" no garantiza que los
 * eventos lleguen al lake — eso lo cuenta el árbol de hoy, que es la otra
 * mitad del cuadro.
 */

const listeners = new Set<IngestListener>()
let timer: NodeJS.Timeout | null = null
let current: IngestStatus = {
  state: 'unknown',
  target: '',
  latencyMs: null,
  checkedAt: null,
}

export function subscribeIngest(listener: IngestListener): () => void {
  listeners.add(listener)
  listener(current)
  return () => {
    listeners.delete(listener)
  }
}

/** Arranca el ciclo: un probe ya mismo y uno cada 5 minutos. Idempotente. */
export function startPinger(): void {
  if (timer) return
  void check()
  timer = setInterval(() => {
    void check()
  }, PING_INTERVAL_MS)
}

async function check(): Promise<void> {
  const { ingest } = loadEnv()
  const target = `${ingest.host}:${ingest.port}`
  const startedAt = Date.now()

  try {
    await probe(ingest.host, ingest.port)
    current = {
      state: 'up',
      target,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    }
  } catch (error) {
    current = {
      state: 'down',
      target,
      latencyMs: null,
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    }
  }

  for (const listener of listeners) listener(current)
}

/** Conectar alcanza: se abre el socket, se mide y se destruye. */
function probe(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new Socket()
    const done = (error?: Error): void => {
      socket.destroy()
      if (error) reject(error)
      else resolve()
    }
    socket.setTimeout(PING_TIMEOUT_MS)
    socket.once('connect', () => done())
    socket.once('timeout', () => done(new Error(`Sin respuesta en ${PING_TIMEOUT_MS} ms`)))
    socket.once('error', (error) => done(error))
    socket.connect(port, host)
  })
}
