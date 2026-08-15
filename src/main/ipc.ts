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
  SettingsResult,
} from '@shared/types'
import { loadEnv } from './env'
// Config: el semáforo del ingestor, las tarjetas de uso y el remedio del índice.
import { getFirebaseUsage, startFirebaseUsage } from './config/firebaseUsage'
import { getGcpUsage, startGcpUsage } from './config/gcpUsage'
import { startPinger, subscribeIngest } from './config/ingestPinger'
import {
  regenerateTreeInDb,
  startRegenerateTree,
  subscribeRegenerateTree,
} from './config/regenerateTree'
// Ingestor monitor: el árbol del lake y el viewer de archivos.
import {
  getDayFiles,
  getFileSample,
  startIngestorMonitor,
  subscribeTree,
} from './ingestor-monitor'
// Live: las sesiones abiertas, su catálogo de eventos y sus preferencias.
import { getEventCatalog } from './live/catalogService'
import { getLiveEvent, subscribeLive } from './live/liveService'
import { readSettings, writeSettings } from './live/settingsService'

const asLayer = (value: unknown): LayerId => (value === 'raw' ? 'raw' : 'bronze')

export function registerIpc(): void {
  // El monitor, el semáforo y los usos arrancan con la app: se alimentan
  // aunque nadie esté mirando.
  startIngestorMonitor()
  startPinger()
  startFirebaseUsage()
  startGcpUsage()
  startRegenerateTree()

  // Cada canal con suscripción guarda UN des-suscriptor por ventana; el
  // oyente de 'destroyed' es único por ventana para no acumular listeners.
  const treeByWebContents = new Map<WebContents, () => void>()
  const regenerateByWebContents = new Map<WebContents, () => void>()
  const ingestByWebContents = new Map<WebContents, () => void>()
  const liveByWebContents = new Map<WebContents, () => void>()

  const stop = (map: Map<WebContents, () => void>, sender: WebContents): void => {
    map.get(sender)?.()
    map.delete(sender)
  }

  const destroyHooked = new WeakSet<WebContents>()
  const hookDestroy = (sender: WebContents): void => {
    if (destroyHooked.has(sender)) return
    destroyHooked.add(sender)
    sender.once('destroyed', () => {
      stop(treeByWebContents, sender)
      stop(regenerateByWebContents, sender)
      stop(ingestByWebContents, sender)
      stop(liveByWebContents, sender)
    })
  }

  // ── El árbol: el único feed de las capas ─────────────────────

  ipcMain.handle(IPC.treeSubscribe, (event): void => {
    const sender = event.sender
    stop(treeByWebContents, sender)
    const unsubscribe = subscribeTree((snapshot) => {
      if (!sender.isDestroyed()) sender.send(IPC.treeSnapshot, snapshot)
    })
    treeByWebContents.set(sender, unsubscribe)
    hookDestroy(sender)
  })

  ipcMain.handle(IPC.treeUnsubscribe, (event): void => {
    stop(treeByWebContents, event.sender)
  })

  ipcMain.handle(
    IPC.layerDayFiles,
    async (_event, rawLayer: unknown, rawDay: unknown): Promise<DayFiles> => {
      const layer = asLayer(rawLayer)
      const day = String(rawDay ?? '')
      try {
        return await getDayFiles(layer, day)
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

  // ── Regeneración del árbol: la orden y su progreso ───────────

  // La app sólo deja la orden en Firestore. El escaneo del bucket y la
  // reparación del índice ocurren en la Cloud Function.
  ipcMain.handle(IPC.regenerateTreeInDb, async (_event, rawLayer: unknown): Promise<void> => {
    await regenerateTreeInDb(asLayer(rawLayer))
  })

  ipcMain.handle(IPC.regenerateTreeSubscribe, (event): void => {
    const sender = event.sender
    stop(regenerateByWebContents, sender)
    const unsubscribe = subscribeRegenerateTree((snapshot) => {
      if (!sender.isDestroyed()) sender.send(IPC.regenerateTreeSnapshot, snapshot)
    })
    regenerateByWebContents.set(sender, unsubscribe)
    hookDestroy(sender)
  })

  ipcMain.handle(IPC.regenerateTreeUnsubscribe, (event): void => {
    stop(regenerateByWebContents, event.sender)
  })

  // ── Semáforo del ingestor ────────────────────────────────────

  ipcMain.handle(IPC.ingestSubscribe, (event): void => {
    const sender = event.sender
    stop(ingestByWebContents, sender)
    const unsubscribe = subscribeIngest((status) => {
      if (!sender.isDestroyed()) sender.send(IPC.ingestStatus, status)
    })
    ingestByWebContents.set(sender, unsubscribe)
    hookDestroy(sender)
  })

  ipcMain.handle(IPC.ingestUnsubscribe, (event): void => {
    stop(ingestByWebContents, event.sender)
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

  ipcMain.handle(IPC.liveSubscribe, (event): void => {
    const sender = event.sender
    stop(liveByWebContents, sender)
    const unsubscribe = subscribeLive((snapshot) => {
      if (!sender.isDestroyed()) sender.send(IPC.liveSnapshot, snapshot)
    })
    liveByWebContents.set(sender, unsubscribe)
    hookDestroy(sender)
  })

  ipcMain.handle(IPC.liveUnsubscribe, (event): void => {
    stop(liveByWebContents, event.sender)
  })

  ipcMain.handle(
    IPC.liveEvent,
    (_event, tabId: string, eventId: string): unknown => getLiveEvent(tabId, eventId),
  )
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
