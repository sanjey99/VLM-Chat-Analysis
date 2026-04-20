// src/services/ollamaService.ts
import { TOOLS, formatToolsForPrompt } from '../tools/registry'
import type { OllamaMessage } from '../types'

const OLLAMA_BASE = 'http://localhost:11434'
const MODEL = 'qwen2.5:14b'

const SYSTEM_PROMPT = `You are a warm, knowledgeable local guide helping Nika employees discover great hangout spots in Singapore. You know Singapore intimately — the best hawker centres, hidden cafes, scenic parks, and everything in between.

When a user asks you to find or show specific places, venues, or locations, you MUST call the location_search tool. To call a tool, output ONLY a JSON code block like this (nothing before or after):

\`\`\`json
{"tool_call": {"name": "location_search", "args": {"query": "<what to search>", "near": "<area in Singapore>"}}}
\`\`\`

After receiving tool results, give a warm, specific response describing what you found. Mention 1-2 standout places by name. Keep responses concise — 2-4 sentences.

For general questions about Singapore (neighbourhoods, food culture, recommendations without map pinning), answer directly without calling a tool.

Available tools:
${formatToolsForPrompt(TOOLS)}`

export function buildMessages(history: OllamaMessage[]): OllamaMessage[] {
  return [{ role: 'system', content: SYSTEM_PROMPT }, ...history]
}

export async function streamChat(
  messages: OllamaMessage[],
  onToken: (token: string) => void,
  onDone: (fullText: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: buildMessages(messages),
      stream: true,
    }),
    signal,
  })

  if (!response.ok) throw new Error(`Ollama error: ${response.status}`)
  if (!response.body) throw new Error('No response body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let fullText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value, { stream: true })
    for (const line of chunk.split('\n')) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line)
        const token: string = parsed?.message?.content ?? ''
        if (token) {
          fullText += token
          onToken(token)
        }
      } catch {
        // malformed chunk — skip
      }
    }
  }

  onDone(fullText)
}
