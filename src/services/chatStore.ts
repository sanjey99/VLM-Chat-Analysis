import type { ChatLog, ChatLogMeta } from '../types'

const INDEX_KEY = 'vlm_chat_index'
const LOG_PREFIX = 'vlm_chat_log_'
const MAX_LOGS = 50

export function loadIndex(): ChatLogMeta[] {
  try { return JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]') }
  catch { return [] }
}

function saveIndex(index: ChatLogMeta[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index))
}

export function loadLog(id: string): ChatLog | null {
  try {
    const raw = localStorage.getItem(LOG_PREFIX + id)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function saveLog(log: ChatLog): void {
  localStorage.setItem(LOG_PREFIX + log.id, JSON.stringify(log))
  const index = loadIndex()
  const i = index.findIndex(m => m.id === log.id)
  const meta: ChatLogMeta = {
    id: log.id,
    filename: log.filename,
    mediaType: log.mediaType,
    modelId: log.modelId,
    createdAt: log.createdAt,
    updatedAt: log.updatedAt,
    messageCount: log.messages.filter(m => m.role !== 'tool').length,
  }
  if (i >= 0) { index[i] = meta } else {
    index.unshift(meta)
    if (index.length > MAX_LOGS) {
      for (const m of index.splice(MAX_LOGS)) localStorage.removeItem(LOG_PREFIX + m.id)
    }
  }
  saveIndex(index)
}

export function deleteLog(id: string): void {
  localStorage.removeItem(LOG_PREFIX + id)
  saveIndex(loadIndex().filter(m => m.id !== id))
}
