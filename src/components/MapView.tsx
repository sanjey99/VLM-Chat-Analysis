import { useState, useCallback, useRef } from 'react'
import DeckGL from '@deck.gl/react'
import { ScatterplotLayer } from '@deck.gl/layers'
import { FlyToInterpolator } from '@deck.gl/core'
import Map from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { GeoJSONPoint } from '../types'
import { MapPopup } from './MapPopup'
import './MapView.css'

const INITIAL_VIEW = {
  longitude: 103.8198,
  latitude: 1.3521,
  zoom: 11,
  pitch: 0,
  bearing: 0,
}

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

interface MapViewProps {
  data: GeoJSONPoint[]
}

interface PopupState {
  point: GeoJSONPoint
  x: number
  y: number
}

export function MapView({ data }: MapViewProps) {
  const [viewState, setViewState] = useState<typeof INITIAL_VIEW>(INITIAL_VIEW)
  const [popup, setPopup] = useState<PopupState | null>(null)
  const prevDataLenRef = useRef(0)

  // Auto-fit viewport when new data arrives
  if (data.length > 0 && data.length !== prevDataLenRef.current) {
    prevDataLenRef.current = data.length
    const lons = data.map((d) => d.geometry.coordinates[0])
    const lats = data.map((d) => d.geometry.coordinates[1])
    const minLon = Math.min(...lons)
    const maxLon = Math.max(...lons)
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    setViewState((v) => ({
      ...v,
      longitude: (minLon + maxLon) / 2,
      latitude: (minLat + maxLat) / 2,
      zoom: data.length === 1 ? 15 : 13,
      transitionDuration: 800,
      transitionInterpolator: new FlyToInterpolator(),
    }))
  }

  const handleClick = useCallback(
    (info: { object?: GeoJSONPoint; x: number; y: number }) => {
      if (info.object) {
        setPopup({ point: info.object, x: info.x, y: info.y })
      } else {
        setPopup(null)
      }
    },
    []
  )

  const layers = [
    new ScatterplotLayer<GeoJSONPoint>({
      id: 'locations',
      data,
      getPosition: (d) => d.geometry.coordinates,
      getRadius: 18,
      radiusUnits: 'pixels',
      getFillColor: [184, 115, 51, 220],
      getLineColor: [230, 160, 80, 255],
      lineWidthMinPixels: 2,
      stroked: true,
      pickable: true,
      onClick: handleClick,
    }),
  ]

  return (
    <div className="map-view" onClick={() => setPopup(null)}>
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: vs }) => setViewState(vs as typeof INITIAL_VIEW)}
        controller={true}
        layers={layers}
      >
        <Map mapStyle={MAP_STYLE} />
      </DeckGL>
      {popup && (
        <MapPopup
          point={popup.point}
          x={popup.x}
          y={popup.y}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  )
}
