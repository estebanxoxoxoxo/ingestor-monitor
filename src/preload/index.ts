import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC } from '@shared/config'
import type { LayerId } from '@shared/config'
import type {
  AppSettings,
  BillingSummary,
  EventCatalog,
  EventsPage,
  EventsQuery,
  FreshnessSnapshot,
  IngestStatus,
  LayerState,
  LiveSnapshot,
  RendererApi,
  SchemaInfo,
  SettingsResult,
  StatusSnapshot,
  SyncProgress,
  SyncResult,
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

  getSchema: (): Promise<SchemaInfo> => ipcRenderer.invoke(IPC.schemaGet),

  getEvents: (query: EventsQuery): Promise<EventsPage> => ipcRenderer.invoke(IPC.eventsQuery, query),

  getRawEvents: (query: EventsQuery): Promise<EventsPage> =>
    ipcRenderer.invoke(IPC.rawQuery, query),

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

  getLayerState: (layer: LayerId): Promise<LayerState> =>
    ipcRenderer.invoke(IPC.layerState, layer),

  runLayerSync: (layer: LayerId): Promise<SyncResult> =>
    ipcRenderer.invoke(IPC.layerSyncRun, layer),

  onLayerSyncProgress: (callback: (progress: SyncProgress) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, progress: SyncProgress): void => callback(progress)
    ipcRenderer.on(IPC.layerSyncProgress, listener)
    return () => {
      ipcRenderer.off(IPC.layerSyncProgress, listener)
    }
  },

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

  getBilling: (refresh: boolean): Promise<BillingSummary> =>
    ipcRenderer.invoke(IPC.billingGet, refresh),

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
