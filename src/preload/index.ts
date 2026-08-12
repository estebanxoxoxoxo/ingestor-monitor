import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC } from '@shared/config'
import type { LayerId } from '@shared/config'
import type {
  AppSettings,
  BillingSummary,
  DayFiles,
  EventCatalog,
  FileSample,
  FileSampleQuery,
  FirebaseUsage,
  FreshnessSnapshot,
  IngestStatus,
  LayerState,
  LiveSnapshot,
  RendererApi,
  SettingsResult,
  StatusSnapshot,
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

  getLayerState: (layer: LayerId): Promise<LayerState> =>
    ipcRenderer.invoke(IPC.layerState, layer),

  relistLayer: (layer: LayerId): Promise<LayerState> =>
    ipcRenderer.invoke(IPC.layerRelist, layer),

  getDayFiles: (layer: LayerId, day: string): Promise<DayFiles> =>
    ipcRenderer.invoke(IPC.layerDayFiles, layer, day),

  getFileSample: (query: FileSampleQuery): Promise<FileSample> =>
    ipcRenderer.invoke(IPC.sampleFile, query),

  subscribeStatus: (callback: (snapshot: StatusSnapshot) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, snapshot: StatusSnapshot): void =>
      callback(snapshot)
    ipcRenderer.on(IPC.statusSnapshot, listener)
    void ipcRenderer.invoke(IPC.statusSubscribe)
    return () => {
      ipcRenderer.off(IPC.statusSnapshot, listener)
      void ipcRenderer.invoke(IPC.statusUnsubscribe)
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

  subscribeFreshness: (callback: (snapshot: FreshnessSnapshot) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, snapshot: FreshnessSnapshot): void =>
      callback(snapshot)
    ipcRenderer.on(IPC.freshnessSnapshot, listener)
    void ipcRenderer.invoke(IPC.freshnessSubscribe)
    return () => {
      ipcRenderer.off(IPC.freshnessSnapshot, listener)
      void ipcRenderer.invoke(IPC.freshnessUnsubscribe)
    }
  },

  getBilling: (refresh: boolean): Promise<BillingSummary> =>
    ipcRenderer.invoke(IPC.billingGet, refresh),

  getFirebaseUsage: (refresh: boolean): Promise<FirebaseUsage> =>
    ipcRenderer.invoke(IPC.firebaseUsageGet, refresh),

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
