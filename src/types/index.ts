export interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: number
}

export interface VideoSession {
  videoId: string
  filename: string
  duration: number
  mediaType: 'video' | 'image'
}

export interface ModelInfo {
  id: string
  label: string
  inputType: 'video' | 'image'
}

export interface SystemInfo {
  gpu: string | null
  vram_total_gb: number | null
  vram_used_gb: number | null
  current_model: string | null
  loading: boolean
  ready: boolean
}
