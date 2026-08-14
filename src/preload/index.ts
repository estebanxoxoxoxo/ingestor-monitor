import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC } from '@shared/config'
import type { LayerId } from '@shared/config'
import type {
  AppSettings,
  DayFiles,
  EventCatalog,
  FileSample,
  FileSampleQuery,
  FirebaseUsage,
  GcpUsage,
  IngestStatus,
  LiveSnapshot,
  RegenerateTreeSnapshot,
  RendererApi,
  SettingsResult,
  TreeSnapshot,
} from '@shared/types'

/**
 * Única superficie que el renderer ve del proceso main. Nada de Node ni de
 * credenciales cruza este puente.
 */
const api: RendererApi = {
  getEventCatalog: (): Promise<EventCatalog> => ipcRenderer.invoke(IPC.eventsCatalog),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsGet),

  saveSettings: (settings: AppSettings): Promise<SettingsResult> =>
    ipcRenderer.invoke(IPC.settingsSave, settings),

  getLiveEvent: (connectionId: string, eventId: string): Promise<unknown | null> =>
    ipcRenderer.invoke(IPC.liveEvent, connectionId, eventId),

  subscribeTree: (callback: (snapshot: TreeSnapshot) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, snapshot: TreeSnapshot): void =>
      callback(snapshot)
    ipcRenderer.on(IPC.treeSnapshot, listener)
    void ipcRenderer.invoke(IPC.treeSubscribe)
    return () => {
      ipcRenderer.off(IPC.treeSnapshot, listener)
      void ipcRenderer.invoke(IPC.treeUnsubscribe)
    }
  },

  getDayFiles: (layer: LayerId, day: string): Promise<DayFiles> =>
    ipcRenderer.invoke(IPC.layerDayFiles, layer, day),

  getFileSample: (query: FileSampleQuery): Promise<FileSample> =>
    ipcRenderer.invoke(IPC.sampleFile, query),

  regenerateTreeInDb: (layer: LayerId): Promise<void> =>
    ipcRenderer.invoke(IPC.regenerateTreeInDb, layer),

  subscribeRegenerateTree: (
    callback: (snapshot: RegenerateTreeSnapshot) => void,
  ): (() => void) => {
    const listener = (_event: IpcRendererEvent, snapshot: RegenerateTreeSnapshot): void =>
      callback(snapshot)
    ipcRenderer.on(IPC.regenerateTreeSnapshot, listener)
    void ipcRenderer.invoke(IPC.regenerateTreeSubscribe)
    return () => {
      ipcRenderer.off(IPC.regenerateTreeSnapshot, listener)
      void ipcRenderer.invoke(IPC.regenerateTreeUnsubscribe)
    }
  },

  subscribeIngest: (callback: (status: IngestStatus) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, status: IngestStatus): void => callback(status)
    ipcRenderer.on(IPC.ingestStatus, listener)
    void ipcRenderer.invoke(IPC.ingestSubscribe)
    return () => {
      ipcRenderer.off(IPC.ingestStatus, listener)
      void ipcRenderer.invoke(IPC.ingestUnsubscribe)
    }
  },

  getFirebaseUsage: (refresh: boolean): Promise<FirebaseUsage> =>
    ipcRenderer.invoke(IPC.firebaseUsageGet, refresh),

  getGcpUsage: (refresh: boolean): Promise<GcpUsage> =>
    ipcRenderer.invoke(IPC.gcpUsageGet, refresh),

  openBillingReport: (): Promise<void> => ipcRenderer.invoke(IPC.billingReportOpen),

  openFirebaseUsage: (): Promise<void> => ipcRenderer.invoke(IPC.firebaseConsoleOpen),

  subscribeLive: (callback: (snapshot: LiveSnapshot) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, snapshot: LiveSnapshot): void => callback(snapshot)
    ipcRenderer.on(IPC.liveSnapshot, listener)
    void ipcRenderer.invoke(IPC.liveSubscribe)
    return () => {
      ipcRenderer.off(IPC.liveSnapshot, listener)
      void ipcRenderer.invoke(IPC.liveUnsubscribe)
    }
  },
}

contextBridge.exposeInMainWorld('api', api)
