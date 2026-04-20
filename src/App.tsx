import { useState } from 'react'
import { MapView } from './components/MapView'
import { ChatPanel } from './components/ChatPanel'
import type { GeoJSONPoint } from './types'
import './App.css'

export default function App() {
  const [mapData, setMapData] = useState<GeoJSONPoint[]>([])

  return (
    <>
      <MapView data={mapData} />
      <ChatPanel onMapData={setMapData} />
    </>
  )
}
