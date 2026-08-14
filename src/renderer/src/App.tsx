import { useState } from 'react'
import { ConfigView } from './components/ConfigView'
import { LayerView } from './components/LayerView'
import { LiveView } from './components/live/LiveView'
import { TopBar } from './components/TopBar'
import { useEventCatalog } from './hooks/useEventCatalog'
import { useIngestStatus } from './hooks/useIngestStatus'
import { useTree } from './hooks/useTree'

/** vivo mira la RTDB; raw y bronze espejan el bucket; config monta guardia. */
export type View = 'vivo' | 'raw' | 'bronze' | 'config'

export function App() {
  const [view, setView] = useState<View>('vivo')
  const { events: catalog, groups, declared } = useEventCatalog()
  // UNA sola suscripción por ventana a cada canal (dos se pisarían en main):
  // el semáforo y el árbol viven acá y bajan por props — el header los
  // necesita aunque no estés parado en una capa.
  const ingest = useIngestStatus()
  const tree = useTree()

  return (
    <div className="app">
      <TopBar view={view} onView={setView} ingest={ingest} tree={tree} />

      {view === 'vivo' && (
        <LiveView active catalog={catalog} groups={groups} declared={declared} />
      )}
      {view === 'raw' && <LayerView layer="raw" title="Raw" tree={tree?.raw ?? null} />}
      {view === 'bronze' && (
        <LayerView layer="bronze" title="Bronze" tree={tree?.bronze ?? null} />
      )}
      {view === 'config' && <ConfigView ingest={ingest} tree={tree} />}
    </div>
  )
}
