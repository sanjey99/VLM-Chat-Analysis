import { describe, it, expect } from 'vitest'
import { extractToolCall, formatToolResult } from '../src/services/agentLoop'

describe('extractToolCall', () => {
  it('detects a tool call JSON block', () => {
    const text = `Sure, let me search for that.\n\`\`\`json\n{"tool_call": {"name": "location_search", "args": {"query": "ramen", "near": "Bugis"}}}\n\`\`\``
    const result = extractToolCall(text)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('location_search')
    expect(result!.args.query).toBe('ramen')
    expect(result!.args.near).toBe('Bugis')
  })

  it('returns null when no tool call present', () => {
    const text = 'Bugis is a great neighbourhood with lots of food options!'
    expect(extractToolCall(text)).toBeNull()
  })

  it('handles tool call without "near" arg', () => {
    const text = '```json\n{"tool_call": {"name": "location_search", "args": {"query": "parks"}}}\n```'
    const result = extractToolCall(text)
    expect(result).not.toBeNull()
    expect(result!.args.near).toBeUndefined()
  })

  it('returns null for malformed JSON', () => {
    const text = '```json\n{broken json\n```'
    expect(extractToolCall(text)).toBeNull()
  })
})

describe('formatToolResult', () => {
  it('formats a GeoJSON result list as readable text', () => {
    const points = [
      {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [103.85, 1.29] as [number, number] },
        properties: { name: 'Ippudo', displayName: 'Ippudo, Bugis', type: 'restaurant' }
      },
    ]
    const text = formatToolResult(points)
    expect(text).toContain('Ippudo')
    expect(text).toContain('1.29')
  })
})
