import type { Message, ToolCall, GeoJSONPoint, OllamaMessage } from '../types'
import { streamChat } from './ollamaService'
import { searchLocations } from './nominatimService'

export function extractToolCall(text: string): ToolCall | null {
  const match = text.match(/```json\s*([\s\S]*?)\s*```/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[1])
    if (parsed?.tool_call?.name) return parsed.tool_call as ToolCall
    return null
  } catch {
    return null
  }
}

export function formatToolResult(points: GeoJSONPoint[]): string {
  if (points.length === 0) return 'No locations found for that search.'
  const lines = points.map(
    (p) =>
      `- ${p.properties.name} (${p.geometry.coordinates[1].toFixed(4)}, ${p.geometry.coordinates[0].toFixed(4)}): ${p.properties.displayName}`
  )
  return `Found ${points.length} location(s):\n${lines.join('\n')}`
}

async function executeTool(call: ToolCall): Promise<GeoJSONPoint[]> {
  if (call.name === 'location_search') {
    return searchLocations(call.args.query, call.args.near)
  }
  throw new Error(`Unknown tool: ${call.name}`)
}

export interface AgentLoopCallbacks {
  onToken: (token: string) => void
  onAssistantMessage: (msg: Message) => void
  onToolCall: (call: ToolCall) => void
  onMapData: (points: GeoJSONPoint[]) => void
  onError: (error: Error) => void
}

export async function runAgentLoop(
  userInput: string,
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

  const ollamaMessages: OllamaMessage[] = updatedHistory
    .filter((m) => m.role !== 'tool')
    .map((m) => ({ role: m.role as OllamaMessage['role'], content: m.content }))

  let finalHistory = updatedHistory

  await streamChat(
    ollamaMessages,
    (token) => {
      callbacks.onToken(token)
    },
    async (fullText) => {
      const toolCall = extractToolCall(fullText)

      if (toolCall) {
        callbacks.onToolCall(toolCall)

        let toolResultPoints: GeoJSONPoint[] = []
        let toolResultText: string

        try {
          toolResultPoints = await executeTool(toolCall)
          toolResultText = formatToolResult(toolResultPoints)
          callbacks.onMapData(toolResultPoints)
        } catch (err) {
          toolResultText = `Tool error: ${(err as Error).message}`
        }

        const toolMessage: Message = {
          id: crypto.randomUUID(),
          role: 'tool',
          content: toolResultText,
          timestamp: Date.now(),
        }

        const messagesWithTool: OllamaMessage[] = [
          ...ollamaMessages,
          { role: 'assistant', content: fullText },
          { role: 'tool', content: toolResultText },
        ]

        let finalText = ''
        await streamChat(
          messagesWithTool,
          (token) => {
            callbacks.onToken(token)
          },
          (done) => { finalText = done },
          signal
        )

        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: finalText || fullText,
          timestamp: Date.now(),
        }
        callbacks.onAssistantMessage(assistantMessage)
        finalHistory = [...updatedHistory, toolMessage, assistantMessage]
      } else {
        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: fullText,
          timestamp: Date.now(),
        }
        callbacks.onAssistantMessage(assistantMessage)
        finalHistory = [...updatedHistory, assistantMessage]
      }
    },
    signal
  )

  return finalHistory
}
