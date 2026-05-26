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
  base_ready?: boolean
  base_loading?: boolean
  base_model?: string | null
}

export interface CompareMetrics {
  ttft_ms: number
  total_ms: number
  tokens_per_sec: number
  token_count: number
}

export type CompareEvent =
  | { phase: 'start_model'; model: string }
  | { phase: 'token'; model: string; token: string }
  | { phase: 'model_done'; model: string; metrics: CompareMetrics }
  | { phase: 'compare_done'; rouge_l: number }
  | { error: string }
