import { useState } from 'react'
import { ConfigView } from './components/ConfigView'
import { LayerView } from './components/LayerView'
import { LiveView } from './components/live/LiveView'
import { TopBar } from './components/TopBar'
import { useEventCatalog } from './hooks/useEventCatalog'
import { useIngestStatus } from './hooks/useIngestStatus'
import { useLayerFreshness } from './hooks/useLayerFreshness'
import { useStatusFeed } from './hooks/useStatusFeed'

/** vivo mira la RTDB; raw y bronze espejan el bucket; config monta guardia. */
export type View = 'vivo' | 'raw' | 'bronze' | 'config'

export function App() {
  const [view, setView] = useState<View>('vivo')
  const { events: catalog, groups, declared } = useEventCatalog()
  // UNA sola suscripción por ventana a cada canal (dos se pisarían en main):
  // el semáforo y el snapshot del vigía viven acá y bajan por props — el
  // header necesita los dos aunque no estés parado en Config.
  const ingest = useIngestStatus()
  const status = useStatusFeed(true)
  const freshness = useLayerFreshness()

  return (
    <div className="app">
      <TopBar
        view={view}
        onView={setView}
        ingest={ingest}
        today={status?.today ?? null}
        freshness={freshness}
      />

      {view === 'vivo' && (
        <LiveView active catalog={catalog} groups={groups} declared={declared} />
      )}
      {view === 'raw' && <LayerView layer="raw" title="Raw" />}
      {view === 'bronze' && <LayerView layer="bronze" title="Bronze" />}
      {view === 'config' && <ConfigView ingest={ingest} snapshot={status} />}
    </div>
  )
}
