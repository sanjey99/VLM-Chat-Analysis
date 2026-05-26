import type { ModelInfo } from '../types'

const BACKEND = 'http://localhost:8000'

async function appFetch(url: string, init?: RequestInit): Promise<Response> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
    return tauriFetch(url, init)
  }
  return globalThis.fetch(url, init)
}

export interface VideoEntry {
  video_id: string
  filename: string
  media_type: 'video' | 'image'
}

export interface CaseResult {
  response: string
  metrics: {
    ttft_ms: number
    total_ms: number
    tokens_per_sec: number
    token_count: number
    vram_used_gb?: number | null
  } | null
  rouge_l: number | null
  bert_score?: number | null
}

export interface LeaderboardEntry {
  model_id: string
  label: string
  avg_ttft_ms: number | null
  avg_tokens_per_sec: number | null
  avg_rouge_l: number | null
  avg_bert_score: number | null
}

export interface DetailEntry {
  case_idx: number
  prompt: string
  reference: string | null
  results: Record<string, CaseResult>
}

export type EvalEvent =
  | { phase: 'loading_model'; model: string; model_idx: number; total_models: number }
  | { phase: 'start_case'; model: string; case_idx: number; total_cases: number }
  | { phase: 'token'; model: string; case_idx: number; token: string }
  | { phase: 'case_done'; model: string; case_idx: number; result: CaseResult }
  | { phase: 'model_done'; model: string }
  | { phase: 'computing_bert_score' }
  | { phase: 'eval_done'; leaderboard: LeaderboardEntry[]; details: DetailEntry[] }
  | { error: string }

export async function fetchVideos(): Promise<VideoEntry[]> {
  const res = await appFetch(`${BACKEND}/videos`)
  if (!res.ok) throw new Error(`Failed to list videos (${res.status})`)
  return res.json()
}

export async function fetchAllModels(): Promise<{ id: string; label: string }[]> {
  const res = await appFetch(`${BACKEND}/models`)
  if (!res.ok) throw new Error(`Failed to list models (${res.status})`)
  const data = await res.json()
  const active: ModelInfo[] = (data.models ?? []).map((m: { id: string; label: string }) => m)
  const base: { id: string; label: string }[] = data.base_models ?? []
  return [...active, ...base]
}

export async function* streamEval(
  cases: Array<{ video_id: string; prompt: string; reference?: string }>,
  modelIds: string[],
  signal?: AbortSignal,
): AsyncGenerator<EvalEvent> {
  const res = await appFetch(`${BACKEND}/eval/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cases, model_ids: modelIds }),
    signal,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? `Eval failed (${res.status})`)
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
        yield JSON.parse(data) as EvalEvent
      } catch (e) {
        if (e instanceof SyntaxError) continue
        throw e
      }
    }
  }
}
