import type { Message, MessageMetrics } from '../types'
import { streamChat } from './vlmService'

export interface AgentLoopCallbacks {
  onToken: (token: string) => void
  onAssistantMessage: (msg: Message) => void
  onError: (error: Error) => void
}

export async function runAgentLoop(
  userInput: string,
  videoId: string,
  history: Message[],
  callbacks: AgentLoopCallbacks,
  signal?: AbortSignal
): Promise<Message[]> {
  const userMessage: Message = {
    id: crypto.randomUUID(),
    role: 'user',
    content: userInput,
    timestamp: Date.now(),
  }

  const updatedHistory = [...history, userMessage]

  const chatHistory = history
    .filter((m) => m.role !== 'tool')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  let fullText = ''
  let metrics: MessageMetrics | undefined

  try {
    for await (const event of streamChat(videoId, userInput, chatHistory, signal)) {
      if (event.type === 'token') {
        fullText += event.token
        callbacks.onToken(event.token)
      } else if (event.type === 'metrics') {
        metrics = event.metrics
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      callbacks.onError(err as Error)
    }
    return updatedHistory
  }

  const assistantMessage: Message = {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: fullText,
    timestamp: Date.now(),
    metrics,
  }
  callbacks.onAssistantMessage(assistantMessage)

  return [...updatedHistory, assistantMessage]
}
