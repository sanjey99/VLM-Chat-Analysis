import type { GeoJSONPoint } from '../types'
import './MapPopup.css'

interface MapPopupProps {
  point: GeoJSONPoint
  x: number
  y: number
  onClose: () => void
}

export function MapPopup({ point, x, y, onClose }: MapPopupProps) {
  return (
    <div
      className="map-popup"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button className="map-popup__close" onClick={onClose} aria-label="Close">×</button>
      <div className="map-popup__name">{point.properties.name}</div>
      {point.properties.type && (
        <div className="map-popup__type">{point.properties.type}</div>
      )}
      <div className="map-popup__address">{point.properties.displayName}</div>
    </div>
  )
}
