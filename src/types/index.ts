// src/types/index.ts

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: number
}

export interface ToolCall {
  name: string
  args: Record<string, string>
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, { type: string; description: string }>
    required: string[]
  }
}

export interface LocationResult {
  name: string
  lat: number
  lon: number
  displayName: string
  type?: string
}

export interface GeoJSONPoint {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: { name: string; displayName: string; type?: string }
}

export interface NominatimResult {
  display_name: string
  lat: string
  lon: string
  type: string
  name?: string
}

export interface AgentLoopState {
  messages: Message[]
  isStreaming: boolean
  mapData: GeoJSONPoint[]
}

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
}
