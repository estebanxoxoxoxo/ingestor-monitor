import { ipcMain } from 'electron'
import type { WebContents } from 'electron'
import { IPC } from '@shared/config'
import type { LayerId } from '@shared/config'
import type {
  AppSettings,
  BillingSummary,
  EventCatalog,
  EventsPage,
  EventsQuery,
  LayerState,
  SchemaInfo,
  SettingsResult,
  SyncResult,
} from '@shared/types'
import { getBilling, startBillingRefresh } from './billing/billingService'
import { getEvents, getSchema } from './events/eventsService'
import { getLiveEvent, subscribeLive } from './live/liveService'
import { getRawEvents } from './raw/rawService'
import { getEventCatalog } from './settings/catalogService'
import { readSettings, writeSettings } from './settings/settingsService'
import { startPinger, subscribeIngest } from './status/ingestPinger'
import { pokeFreshness, startFreshness, subscribeFreshness } from './status/layerFreshness'
import { startWatcher, subscribeStatus } from './status/statusService'
import { getLayerState, runLayerSync } from './sync/syncService'

/** Una sync por capa a la vez: dos corridas de la misma capa se pisarían. */
const running = new Set<LayerId>()

const asLayer = (value: unknown): LayerId => (value === 'raw' ? 'raw' : 'bronze')

const failedResult = (layer: LayerId, error: string): SyncResult => ({
  layer,
  ok: false,
  from: null,
  to: null,
  downloaded: 0,
  skipped: 0,
  discarded: 0,
  bytes: 0,
  lastSyncAt: null,
  failures: [],
  error,
})

export function registerIpc(): void {
  // El vigía, la facturación, el semáforo y la frescura arrancan con la
  // app: se alimentan aunque nadie esté mirando Status.
  startWatcher()
  startBillingRefresh()
  startPinger()
  startFreshness()

  // ── Capas: estado y sincronización ───────────────────────────

  ipcMain.handle(IPC.layerState, async (_event, rawLayer: unknown): Promise<LayerState> => {
    const layer = asLayer(rawLayer)
    try {
      return await getLayerState(layer)
    } catch (error) {
      return {
        layer,
        lastSyncAt: null,
        cacheDir: '',
        files: 0,
        bytes: 0,
        days: [],
        error: messageOf(error),
      }
    }
  })

  ipcMain.handle(IPC.layerSyncRun, async (event, rawLayer: unknown): Promise<SyncResult> => {
    const layer = asLayer(rawLayer)
    if (running.has(layer)) {
      return failedResult(layer, 'Ya hay una sincronización de esta capa en curso.')
    }
    running.add(layer)
    try {
      return await runLayerSync(layer, (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send(IPC.layerSyncProgress, progress)
      })
    } catch (error) {
      return failedResult(layer, messageOf(error))
    } finally {
      running.delete(layer)
      // El espejo pudo cambiar: el punto de la pestaña se recalcula al toque.
      pokeFreshness()
    }
  })

  // ── Bronze: esquema y tabla de eventos (drill-in por día) ────

  ipcMain.handle(IPC.schemaGet, async (): Promise<SchemaInfo> => {
    try {
      return await getSchema()
    } catch (error) {
      return { versions: [], messageName: null, columns: [], sources: [], error: messageOf(error) }
    }
  })

  ipcMain.handle(IPC.eventsQuery, async (_event, request: EventsQuery): Promise<EventsPage> => {
    try {
      return await getEvents(request)
    } catch (error) {
      return {
        rows: [],
        total: 0,
        limit: request.limit,
        offset: request.offset,
        error: messageOf(error),
      }
    }
  })

  ipcMain.handle(IPC.rawQuery, async (_event, request: EventsQuery): Promise<EventsPage> => {
    try {
      return await getRawEvents(request)
    } catch (error) {
      return {
        rows: [],
        total: 0,
        limit: request.limit,
        offset: request.offset,
        error: messageOf(error),
      }
    }
  })

  // ── Semáforo del ingestor ────────────────────────────────────

  const ingestByWebContents = new Map<WebContents, () => void>()

  const stopIngest = (sender: WebContents): void => {
    ingestByWebContents.get(sender)?.()
    ingestByWebContents.delete(sender)
  }

  ipcMain.handle(IPC.ingestSubscribe, (event): void => {
    const sender = event.sender
    stopIngest(sender)
    const unsubscribe = subscribeIngest((status) => {
      if (!sender.isDestroyed()) sender.send(IPC.ingestStatus, status)
    })
    ingestByWebContents.set(sender, unsubscribe)
    sender.once('destroyed', () => stopIngest(sender))
  })

  ipcMain.handle(IPC.ingestUnsubscribe, (event): void => {
    stopIngest(event.sender)
  })

  // ── Frescura de las capas (contra la caché local) ────────────

  const freshnessByWebContents = new Map<WebContents, () => void>()

  const stopFreshness = (sender: WebContents): void => {
    freshnessByWebContents.get(sender)?.()
    freshnessByWebContents.delete(sender)
  }

  ipcMain.handle(IPC.freshnessSubscribe, (event): void => {
    const sender = event.sender
    stopFreshness(sender)
    const unsubscribe = subscribeFreshness((snapshot) => {
      if (!sender.isDestroyed()) sender.send(IPC.freshnessSnapshot, snapshot)
    })
    freshnessByWebContents.set(sender, unsubscribe)
    sender.once('destroyed', () => stopFreshness(sender))
  })

  ipcMain.handle(IPC.freshnessUnsubscribe, (event): void => {
    stopFreshness(event.sender)
  })

  // ── Status: feed del pipeline por suscripción a Firestore ────

  const statusByWebContents = new Map<WebContents, () => void>()

  const stopStatus = (sender: WebContents): void => {
    statusByWebContents.get(sender)?.()
    statusByWebContents.delete(sender)
  }

  ipcMain.handle(IPC.statusSubscribe, (event): void => {
    const sender = event.sender
    stopStatus(sender)
    const unsubscribe = subscribeStatus((snapshot) => {
      if (!sender.isDestroyed()) sender.send(IPC.statusSnapshot, snapshot)
    })
    statusByWebContents.set(sender, unsubscribe)
    sender.once('destroyed', () => stopStatus(sender))
  })

  ipcMain.handle(IPC.statusUnsubscribe, (event): void => {
    stopStatus(event.sender)
  })

  // ── Facturación ──────────────────────────────────────────────

  ipcMain.handle(IPC.billingGet, async (_event, refresh: unknown): Promise<BillingSummary> => {
    return getBilling(refresh === true)
  })

  // ── Catálogo y preferencias (los usa Vivo) ───────────────────

  ipcMain.handle(IPC.eventsCatalog, async (): Promise<EventCatalog> => {
    try {
      return await getEventCatalog()
    } catch (error) {
      return { events: [], groups: [], declared: false, error: messageOf(error) }
    }
  })

  ipcMain.handle(IPC.settingsGet, async (): Promise<AppSettings> => {
    try {
      return await readSettings()
    } catch (error) {
      // Típicamente el .env incompleto. Se muestra en la UI, no se cae la app.
      return { relevantEvents: [], error: messageOf(error) }
    }
  })

  ipcMain.handle(
    IPC.settingsSave,
    async (_event, settings: AppSettings): Promise<SettingsResult> => {
      try {
        await writeSettings(settings)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: messageOf(error) }
      }
    },
  )

  // ── Vivo ─────────────────────────────────────────────────────
  // Una suscripción por ventana. Se corta sola si la ventana se destruye, para
  // no dejar el listener de la RTDB colgado.
  const liveByWebContents = new Map<WebContents, () => void>()

  const stopLive = (sender: WebContents): void => {
    liveByWebContents.get(sender)?.()
    liveByWebContents.delete(sender)
  }

  ipcMain.handle(IPC.liveSubscribe, (event): void => {
    const sender = event.sender
    stopLive(sender)
    const unsubscribe = subscribeLive((snapshot) => {
      if (!sender.isDestroyed()) sender.send(IPC.liveSnapshot, snapshot)
    })
    liveByWebContents.set(sender, unsubscribe)
    sender.once('destroyed', () => stopLive(sender))
  })

  ipcMain.handle(IPC.liveUnsubscribe, (event): void => {
    stopLive(event.sender)
  })

  ipcMain.handle(
    IPC.liveEvent,
    (_event, connectionId: string, eventId: string): unknown =>
      getLiveEvent(connectionId, eventId),
  )
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
