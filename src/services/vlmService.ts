import type { ModelInfo, SystemInfo } from '../types'

const BACKEND = 'http://localhost:8000'

export interface UploadResult {
  video_id: string
  filename: string
  duration: number
}

export async function uploadVideo(file: File): Promise<UploadResult> {
  const body = new FormData()
  body.append('file', file)

  const res = await fetch(`${BACKEND}/upload`, { method: 'POST', body })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? `Upload failed (${res.status})`)
  }
  return res.json()
}

export async function* streamChat(
  videoId: string,
  prompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const res = await fetch(`${BACKEND}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_id: videoId, prompt, history }),
    signal,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? `Chat failed (${res.status})`)
  }
  if (!res.body) throw new Error('No response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') return
      try {
        const parsed = JSON.parse(data)
        if (parsed.error) throw new Error(parsed.error)
        if (parsed.token) yield parsed.token
      } catch (e) {
        if (e instanceof SyntaxError) continue
        throw e
      }
    }
  }
}

export async function checkHealth(): Promise<'ready' | 'loading' | 'offline'> {
  try {
    const res = await fetch(`${BACKEND}/health`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return 'offline'
    const data = await res.json()
    return data.status === 'ready' ? 'ready' : 'loading'
  } catch {
    return 'offline'
  }
}

export async function listModels(): Promise<{
  models: ModelInfo[]
  current: string | null
  loading: boolean
}> {
  const res = await fetch(`${BACKEND}/models`)
  if (!res.ok) throw new Error(`Failed to list models (${res.status})`)
  return res.json()
}

export async function loadModel(modelId: string): Promise<void> {
  const res = await fetch(`${BACKEND}/load-model`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_id: modelId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? `Load failed (${res.status})`)
  }
}

export async function getSystemInfo(): Promise<SystemInfo> {
  const res = await fetch(`${BACKEND}/system/info`)
  if (!res.ok) throw new Error(`Failed to get system info (${res.status})`)
  return res.json()
}
