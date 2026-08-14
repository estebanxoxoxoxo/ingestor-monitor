import { ipcMain, shell } from 'electron'
import type { WebContents } from 'electron'
import { BILLING_REPORT_URL, IPC } from '@shared/config'
import type { LayerId } from '@shared/config'
import type {
  AppSettings,
  DayFiles,
  EventCatalog,
  FileSample,
  FileSampleQuery,
  FirebaseUsage,
  GcpUsage,
  LayerState,
  SettingsResult,
} from '@shared/types'
import { loadEnv } from './env'
// Config: el semáforo del ingestor y las tarjetas de uso.
import { getFirebaseUsage, startFirebaseUsage } from './config/firebaseUsage'
import { getGcpUsage, startGcpUsage } from './config/gcpUsage'
import { startPinger, subscribeIngest } from './config/ingestPinger'
// Ingest monitor: el índice del lake y el viewer de archivos.
import { baseName, instantOf } from './ingest-monitor/indexMath'
import {
  dayObjects,
  getLayerState,
  relistLayer,
  startInventory,
  subscribeFreshness,
  subscribeStatus,
} from './ingest-monitor/inventoryService'
import { getFileSample } from './ingest-monitor/sampleService'
// Live: las sesiones abiertas, su catálogo de eventos y sus preferencias.
import { getEventCatalog } from './live/catalogService'
import { getLiveEvent, subscribeLive } from './live/liveService'
import { readSettings, writeSettings } from './live/settingsService'

const asLayer = (value: unknown): LayerId => (value === 'raw' ? 'raw' : 'bronze')

export function registerIpc(): void {
  // El vigía, el semáforo y los usos arrancan con la app: se alimentan
  // aunque nadie esté mirando.
  startInventory()
  startPinger()
  startFirebaseUsage()
  startGcpUsage()

  // ── Capas: índice del bucket y viewer de archivos ────────────

  ipcMain.handle(IPC.layerState, (_event, rawLayer: unknown): LayerState => {
    return getLayerState(asLayer(rawLayer))
  })

  ipcMain.handle(IPC.layerRelist, async (_event, rawLayer: unknown): Promise<LayerState> => {
    const layer = asLayer(rawLayer)
    try {
      return await relistLayer(layer)
    } catch (error) {
      return {
        layer,
        listedAt: null,
        files: 0,
        bytes: 0,
        days: [],
        latest: [],
        error: messageOf(error),
      }
    }
  })

  ipcMain.handle(
    IPC.layerDayFiles,
    async (_event, rawLayer: unknown, rawDay: unknown): Promise<DayFiles> => {
      const layer = asLayer(rawLayer)
      const day = String(rawDay ?? '')
      try {
        const objects = await dayObjects(layer, day)
        const sorted = [...objects].sort((a, b) => instantOf(b) - instantOf(a))
        return {
          layer,
          day,
          files: sorted.map((object) => ({
            name: baseName(object.key),
            size: object.size,
            at:
              object.lastModified ??
              (instantOf(object) > 0 ? new Date(instantOf(object)).toISOString() : null),
          })),
          bytes: objects.reduce((sum, object) => sum + object.size, 0),
        }
      } catch (error) {
        return { layer, day, files: [], bytes: 0, error: messageOf(error) }
      }
    },
  )

  ipcMain.handle(
    IPC.sampleFile,
    async (_event, request: FileSampleQuery): Promise<FileSample> => {
      try {
        return await getFileSample(request)
      } catch (error) {
        return { columns: [], rows: [], truncated: false, error: messageOf(error) }
      }
    },
  )

  // ── Status: feed del vigía ───────────────────────────────────

  const statusByWebContents = new Map<WebContents, () => void>()

  const stopStatus = (sender: WebContents): void => {
    statusByWebContents.get(sender)?.()
    statusByWebContents.delete(sender)
  }

  // UN solo oyente de 'destroyed' por ventana, para TODOS los canales. Si se
  // agregara uno por (re)suscripción, se acumularían con cada cambio de
  // pestaña hasta el warning de MaxListeners de Node.
  const destroyHooked = new WeakSet<WebContents>()
  const hookDestroy = (sender: WebContents): void => {
    if (destroyHooked.has(sender)) return
    destroyHooked.add(sender)
    sender.once('destroyed', () => {
      stopStatus(sender)
      stopFreshness(sender)
      stopIngest(sender)
      stopLive(sender)
    })
  }

  ipcMain.handle(IPC.statusSubscribe, (event): void => {
    const sender = event.sender
    stopStatus(sender)
    const unsubscribe = subscribeStatus((snapshot) => {
      if (!sender.isDestroyed()) sender.send(IPC.statusSnapshot, snapshot)
    })
    statusByWebContents.set(sender, unsubscribe)
    hookDestroy(sender)
  })

  ipcMain.handle(IPC.statusUnsubscribe, (event): void => {
    stopStatus(event.sender)
  })

  // ── Frescura de las capas ────────────────────────────────────

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
    hookDestroy(sender)
  })

  ipcMain.handle(IPC.freshnessUnsubscribe, (event): void => {
    stopFreshness(event.sender)
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
    hookDestroy(sender)
  })

  ipcMain.handle(IPC.ingestUnsubscribe, (event): void => {
    stopIngest(event.sender)
  })

  // ── Uso de Firebase y de Google Cloud ────────────────────────

  ipcMain.handle(
    IPC.firebaseUsageGet,
    async (_event, refresh: unknown): Promise<FirebaseUsage> => {
      return getFirebaseUsage(refresh === true)
    },
  )

  ipcMain.handle(IPC.gcpUsageGet, async (_event, refresh: unknown): Promise<GcpUsage> => {
    return getGcpUsage(refresh === true)
  })

  // Las consolas se abren en el NAVEGADOR (logueado): Google no permite
  // embeberlas — sus páginas rechazan iframes y su login, webviews.
  ipcMain.handle(IPC.billingReportOpen, async (): Promise<void> => {
    await shell.openExternal(BILLING_REPORT_URL)
  })

  ipcMain.handle(IPC.firebaseConsoleOpen, async (): Promise<void> => {
    const projectId = loadEnv().firebase.projectId
    await shell.openExternal(
      `https://console.firebase.google.com/u/0/project/${projectId}/usage?hl=es-419`,
    )
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
    hookDestroy(sender)
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
