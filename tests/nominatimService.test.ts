import { describe, it, expect, vi, beforeEach } from 'vitest'
import { searchLocations } from '../src/services/nominatimService'

const mockNominatimResponse = [
  {
    display_name: 'Ippudo, Bugis Junction, Singapore',
    lat: '1.2991',
    lon: '103.8554',
    type: 'restaurant',
    name: 'Ippudo',
  },
  {
    display_name: 'Santouka, Bugis+, Singapore',
    lat: '1.3001',
    lon: '103.8560',
    type: 'restaurant',
    name: 'Santouka',
  },
]

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => mockNominatimResponse,
  } as Response)
})

describe('searchLocations', () => {
  it('calls Nominatim with correct URL', async () => {
    await searchLocations('ramen', 'Bugis')
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('nominatim.openstreetmap.org'),
      expect.objectContaining({ headers: expect.any(Object) })
    )
  })

  it('returns GeoJSON Feature array', async () => {
    const result = await searchLocations('ramen', 'Bugis')
    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('Feature')
    expect(result[0].geometry.type).toBe('Point')
    expect(result[0].geometry.coordinates).toHaveLength(2)
  })

  it('maps display_name to properties', async () => {
    const result = await searchLocations('ramen', 'Bugis')
    expect(result[0].properties.name).toBe('Ippudo')
    expect(result[0].properties.displayName).toBe('Ippudo, Bugis Junction, Singapore')
  })

  it('handles empty results gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response)
    const result = await searchLocations('nonexistent place xyz', 'nowhere')
    expect(result).toEqual([])
  })
})
