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
}
