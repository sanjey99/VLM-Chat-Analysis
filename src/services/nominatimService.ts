import type { GeoJSONPoint, NominatimResult } from '../types'

const BASE_URL = 'https://nominatim.openstreetmap.org/search'
const HEADERS = {
  'User-Agent': 'NikaAIAgent/1.0 (sanjeychrysh@gmail.com)',
  'Accept-Language': 'en',
}

export async function searchLocations(
  query: string,
  near?: string
): Promise<GeoJSONPoint[]> {
  const searchTerm = near
    ? `${query} near ${near}, Singapore`
    : `${query}, Singapore`

  const url = new URL(BASE_URL)
  url.searchParams.set('q', searchTerm)
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', '10')
  url.searchParams.set('addressdetails', '1')

  const response = await fetch(url.toString(), { headers: HEADERS })
  if (!response.ok) throw new Error(`Nominatim error: ${response.status}`)

  const results: NominatimResult[] = await response.json()
  return results.map(toGeoJSON)
}

function toGeoJSON(r: NominatimResult): GeoJSONPoint {
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [parseFloat(r.lon), parseFloat(r.lat)],
    },
    properties: {
      name: r.name ?? r.display_name.split(',')[0].trim(),
      displayName: r.display_name,
      type: r.type,
    },
  }
}
