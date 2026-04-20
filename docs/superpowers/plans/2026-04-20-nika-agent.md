# Nika AI Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Tauri v2 desktop app where a local Ollama LLM acts as a location intelligence agent — users type natural-language queries, the agent calls Nominatim to find Singapore locations, and results render as interactive deck.gl layers on a MapLibre map.

**Architecture:** Prompt-engineered JSON tool-calling loop (no native Ollama tools API). React frontend directly fetches Ollama's streaming API via ReadableStream. MapLibre GL JS provides the base map; deck.gl ScatterplotLayer renders agent results as interactive markers on top.

**Tech Stack:** Tauri v2, React 18, TypeScript, deck.gl 9, MapLibre GL JS 4, Vitest, Nominatim (OpenStreetMap)

**Design:** Dark warm charcoal background, amber accents, Bricolage Grotesque + Source Serif 4 fonts. Right sidebar (320px) for chat, map takes remaining width. See `.impeccable.md` for full design context.

**Write every decision, design choice, and trade-off to `sanjey.md` as you implement each task.**

---

## File Map

```
src/
├── types/
│   └── index.ts               # All shared interfaces (Message, ToolCall, LocationResult, etc.)
├── tools/
│   └── registry.ts            # Tool definitions as TypeScript types + JSON schema
├── services/
│   ├── nominatimService.ts    # Nominatim API → GeoJSON points
│   ├── ollamaService.ts       # Streaming fetch to Ollama, system prompt construction
│   └── agentLoop.ts           # Full tool-calling loop: send → parse → execute → feed back
├── components/
│   ├── MapView.tsx            # deck.gl + MapLibre base, layers, popup on click, auto-fit
│   ├── MessageBubble.tsx      # User vs agent message styling
│   ├── ChatPanel.tsx          # Scrollable history + input
│   └── MapPopup.tsx           # Tooltip shown on marker click
├── App.tsx                    # Root layout: map (flex:1) + sidebar (320px)
├── App.css                    # Design system: CSS variables, fonts, base styles
└── main.tsx                   # Entry point (unchanged from scaffold)

src-tauri/                     # Minimal Rust shell — no custom commands needed
tests/
├── nominatimService.test.ts
└── agentLoop.test.ts
```

---

## Task 1: Scaffold Tauri v2 + React + TypeScript project

**Files:**
- Create: project root (Tauri scaffold)
- Modify: `package.json` (add dependencies)
- Modify: `src-tauri/tauri.conf.json` (window title)

- [ ] **Step 1: Scaffold the project**

Run in `C:/Users/sanje/Documents/Github/nika_aiagent`:
```bash
npm create tauri-app@latest . -- --template react-ts --manager npm
```
When prompted: app name = `nika-agent`, window title = `Nika Agent`.

- [ ] **Step 2: Install frontend dependencies**

```bash
npm install @deck.gl/core @deck.gl/layers @deck.gl/react @deck.gl/mapbox maplibre-gl react-map-gl
npm install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 3: Install Google Fonts (Bricolage Grotesque + Source Serif 4)**

Add to `index.html` `<head>`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300..800&family=Source+Serif+4:ital,opsz,wght@0,8..60,300..900;1,8..60,300..900&display=swap" rel="stylesheet">
```

- [ ] **Step 4: Configure Vitest in vite.config.ts**

Add to `vite.config.ts`:
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
})
```

Create `src/test-setup.ts`:
```typescript
import '@testing-library/jest-dom'
```

- [ ] **Step 5: Update tsconfig.json for test globals**

Ensure `compilerOptions` includes:
```json
{
  "compilerOptions": {
    "types": ["vitest/globals"]
  }
}
```

- [ ] **Step 6: Add test script to package.json**

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 7: Verify scaffold runs**

```bash
npm run dev
```
Expected: Tauri window opens with default Vite+React template.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: scaffold Tauri v2 + React + TypeScript project with dependencies"
```

---

## Task 2: TypeScript types

**Files:**
- Create: `src/types/index.ts`

- [ ] **Step 1: Create the types file**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add shared TypeScript interfaces"
```

---

## Task 3: Tool registry

**Files:**
- Create: `src/tools/registry.ts`

- [ ] **Step 1: Create tool registry**

```typescript
// src/tools/registry.ts
import type { ToolDefinition } from '../types'

export const TOOLS: ToolDefinition[] = [
  {
    name: 'location_search',
    description:
      'Search for locations, venues, or places in Singapore using natural language. Use this when the user asks to find specific places, restaurants, parks, cafes, or any location-based query. Returns a list of matching places.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'What to search for — e.g. "ramen restaurants", "parks", "coffee shops", "hawker centres"',
        },
        near: {
          type: 'string',
          description:
            'Area, neighbourhood, or MRT station in Singapore — e.g. "Bugis", "Tanjong Pagar", "Punggol". Omit if searching island-wide.',
        },
      },
      required: ['query'],
    },
  },
]

export function formatToolsForPrompt(tools: ToolDefinition[]): string {
  return tools
    .map(
      (t) =>
        `Tool: ${t.name}\nDescription: ${t.description}\nParameters: ${JSON.stringify(t.parameters, null, 2)}`
    )
    .join('\n\n')
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tools/registry.ts
git commit -m "feat: add tool registry with location_search definition"
```

---

## Task 4: Nominatim service (with tests)

**Files:**
- Create: `src/services/nominatimService.ts`
- Create: `tests/nominatimService.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/nominatimService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { searchLocations } from '../src/services/nominatimService'

const mockNominatimResponse = [
  {
    display_name: 'Ippudo, Bugis Junction, Singapore',
    lat: '1.2991',
    lon: '103.8554',
    type: 'restaurant',
    name: 'Ippudo',
  },
  {
    display_name: 'Santouka, Bugis+, Singapore',
    lat: '1.3001',
    lon: '103.8560',
    type: 'restaurant',
    name: 'Santouka',
  },
]

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => mockNominatimResponse,
  } as Response)
})

describe('searchLocations', () => {
  it('calls Nominatim with correct URL', async () => {
    await searchLocations('ramen', 'Bugis')
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('nominatim.openstreetmap.org'),
      expect.objectContaining({ headers: expect.any(Object) })
    )
  })

  it('returns GeoJSON Feature array', async () => {
    const result = await searchLocations('ramen', 'Bugis')
    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('Feature')
    expect(result[0].geometry.type).toBe('Point')
    expect(result[0].geometry.coordinates).toHaveLength(2)
  })

  it('maps display_name to properties', async () => {
    const result = await searchLocations('ramen', 'Bugis')
    expect(result[0].properties.name).toBe('Ippudo')
    expect(result[0].properties.displayName).toBe('Ippudo, Bugis Junction, Singapore')
  })

  it('handles empty results gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response)
    const result = await searchLocations('nonexistent place xyz', 'nowhere')
    expect(result).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test
```
Expected: FAIL — "Cannot find module '../src/services/nominatimService'"

- [ ] **Step 3: Implement Nominatim service**

```typescript
// src/services/nominatimService.ts
import type { GeoJSONPoint, NominatimResult } from '../types'

const BASE_URL = 'https://nominatim.openstreetmap.org/search'
const HEADERS = {
  'User-Agent': 'NikaAIAgent/1.0 (sanjeychrysh@gmail.com)',
  'Accept-Language': 'en',
}

export async function searchLocations(
  query: string,
  near?: string
): Promise<GeoJSONPoint[]> {
  const searchTerm = near
    ? `${query} near ${near}, Singapore`
    : `${query}, Singapore`

  const url = new URL(BASE_URL)
  url.searchParams.set('q', searchTerm)
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', '10')
  url.searchParams.set('addressdetails', '1')

  const response = await fetch(url.toString(), { headers: HEADERS })
  if (!response.ok) throw new Error(`Nominatim error: ${response.status}`)

  const results: NominatimResult[] = await response.json()
  return results.map(toGeoJSON)
}

function toGeoJSON(r: NominatimResult): GeoJSONPoint {
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [parseFloat(r.lon), parseFloat(r.lat)],
    },
    properties: {
      name: r.name ?? r.display_name.split(',')[0].trim(),
      displayName: r.display_name,
      type: r.type,
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test
```
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/nominatimService.ts tests/nominatimService.test.ts
git commit -m "feat: add Nominatim service with GeoJSON output"
```

---

## Task 5: Ollama service + streaming

**Files:**
- Create: `src/services/ollamaService.ts`

- [ ] **Step 1: Create the Ollama service**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/services/ollamaService.ts
git commit -m "feat: add Ollama streaming service with system prompt"
```

---

## Task 6: Agent loop (with tests)

**Files:**
- Create: `src/services/agentLoop.ts`
- Create: `tests/agentLoop.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/agentLoop.test.ts
import { describe, it, expect } from 'vitest'
import { extractToolCall, formatToolResult } from '../src/services/agentLoop'

describe('extractToolCall', () => {
  it('detects a tool call JSON block', () => {
    const text = `Sure, let me search for that.\n\`\`\`json\n{"tool_call": {"name": "location_search", "args": {"query": "ramen", "near": "Bugis"}}}\n\`\`\``
    const result = extractToolCall(text)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('location_search')
    expect(result!.args.query).toBe('ramen')
    expect(result!.args.near).toBe('Bugis')
  })

  it('returns null when no tool call present', () => {
    const text = 'Bugis is a great neighbourhood with lots of food options!'
    expect(extractToolCall(text)).toBeNull()
  })

  it('handles tool call without "near" arg', () => {
    const text = '```json\n{"tool_call": {"name": "location_search", "args": {"query": "parks"}}}\n```'
    const result = extractToolCall(text)
    expect(result).not.toBeNull()
    expect(result!.args.near).toBeUndefined()
  })

  it('returns null for malformed JSON', () => {
    const text = '```json\n{broken json\n```'
    expect(extractToolCall(text)).toBeNull()
  })
})

describe('formatToolResult', () => {
  it('formats a GeoJSON result list as readable text', () => {
    const points = [
      { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [103.85, 1.29] as [number, number] }, properties: { name: 'Ippudo', displayName: 'Ippudo, Bugis', type: 'restaurant' } },
    ]
    const text = formatToolResult(points)
    expect(text).toContain('Ippudo')
    expect(text).toContain('1.29')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement agent loop**

```typescript
// src/services/agentLoop.ts
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

  // Build Ollama message history
  const ollamaMessages: OllamaMessage[] = updatedHistory
    .filter((m) => m.role !== 'tool')
    .map((m) => ({ role: m.role as OllamaMessage['role'], content: m.content }))

  let assistantText = ''

  await streamChat(
    ollamaMessages,
    (token) => {
      assistantText += token
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

        // Feed tool result back to model for final response
        const messagesWithTool: OllamaMessage[] = [
          ...ollamaMessages,
          { role: 'assistant', content: fullText },
          { role: 'tool', content: toolResultText },
        ]

        let finalText = ''
        await streamChat(
          messagesWithTool,
          (token) => {
            finalText += token
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
        return [...updatedHistory, toolMessage, assistantMessage]
      } else {
        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: fullText,
          timestamp: Date.now(),
        }
        callbacks.onAssistantMessage(assistantMessage)
      }
    },
    signal
  )

  return updatedHistory
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/agentLoop.ts tests/agentLoop.test.ts
git commit -m "feat: add agent loop with tool call detection and execution"
```

---

## Task 7: Design system (CSS variables + fonts)

**Files:**
- Modify: `src/App.css` (replace with design system)
- Modify: `src/index.css` (base reset)

- [ ] **Step 1: Replace App.css with design system**

```css
/* src/App.css */
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300..800&family=Source+Serif+4:ital,opsz,wght@0,8..60,300..900;1,8..60,300..900&display=swap');

:root {
  /* Palette — dark warm charcoal, amber accents */
  --bg-base:      oklch(0.12 0.01 60);
  --bg-surface:   oklch(0.16 0.012 60);
  --bg-elevated:  oklch(0.21 0.015 60);
  --bg-input:     oklch(0.18 0.013 60);

  --accent:       oklch(0.72 0.14 55);
  --accent-dim:   oklch(0.50 0.10 55);
  --accent-subtle: oklch(0.25 0.05 55);

  --text-primary:   oklch(0.92 0.01 60);
  --text-secondary: oklch(0.55 0.01 60);
  --text-muted:     oklch(0.38 0.008 60);

  --border:       oklch(0.22 0.01 60);

  /* Spacing scale — 4pt base */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;

  /* Typography */
  --font-ui: 'Bricolage Grotesque', system-ui, sans-serif;
  --font-chat: 'Source Serif 4', Georgia, serif;

  /* Sidebar */
  --sidebar-width: 320px;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: 14px;
  line-height: 1.5;
  overflow: hidden;
}

#root {
  width: 100vw;
  height: 100vh;
  display: flex;
}

/* Scrollbars */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
```

- [ ] **Step 2: Commit**

```bash
git add src/App.css src/index.css
git commit -m "feat: add design system CSS variables and base styles"
```

---

## Task 8: MapPopup component

**Files:**
- Create: `src/components/MapPopup.tsx`

- [ ] **Step 1: Create MapPopup**

```tsx
// src/components/MapPopup.tsx
import type { GeoJSONPoint } from '../types'
import './MapPopup.css'

interface MapPopupProps {
  point: GeoJSONPoint
  x: number
  y: number
  onClose: () => void
}

export function MapPopup({ point, x, y, onClose }: MapPopupProps) {
  return (
    <div
      className="map-popup"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button className="map-popup__close" onClick={onClose} aria-label="Close">×</button>
      <div className="map-popup__name">{point.properties.name}</div>
      {point.properties.type && (
        <div className="map-popup__type">{point.properties.type}</div>
      )}
      <div className="map-popup__address">{point.properties.displayName}</div>
    </div>
  )
}
```

Create `src/components/MapPopup.css`:
```css
.map-popup {
  position: absolute;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: var(--space-4);
  min-width: 200px;
  max-width: 280px;
  transform: translate(-50%, calc(-100% - 12px));
  pointer-events: all;
  z-index: 10;
  box-shadow: 0 4px 24px oklch(0 0 0 / 0.4);
}

.map-popup__close {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  padding: 0 var(--space-1);
}
.map-popup__close:hover { color: var(--text-primary); }

.map-popup__name {
  font-family: var(--font-ui);
  font-weight: 600;
  font-size: 15px;
  color: var(--text-primary);
  margin-bottom: var(--space-1);
  padding-right: var(--space-6);
}

.map-popup__type {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--accent);
  margin-bottom: var(--space-2);
}

.map-popup__address {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MapPopup.tsx src/components/MapPopup.css
git commit -m "feat: add MapPopup tooltip component"
```

---

## Task 9: MapView component

**Files:**
- Create: `src/components/MapView.tsx`
- Create: `src/components/MapView.css`

- [ ] **Step 1: Create MapView**

```tsx
// src/components/MapView.tsx
import { useState, useCallback } from 'react'
import DeckGL from '@deck.gl/react'
import { ScatterplotLayer } from '@deck.gl/layers'
import { FlyToInterpolator } from '@deck.gl/core'
import Map from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { GeoJSONPoint } from '../types'
import { MapPopup } from './MapPopup'
import './MapView.css'

const INITIAL_VIEW = {
  longitude: 103.8198,
  latitude: 1.3521,
  zoom: 11,
  pitch: 0,
  bearing: 0,
}

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

interface MapViewProps {
  data: GeoJSONPoint[]
}

interface PopupState {
  point: GeoJSONPoint
  x: number
  y: number
}

export function MapView({ data }: MapViewProps) {
  const [viewState, setViewState] = useState(INITIAL_VIEW)
  const [popup, setPopup] = useState<PopupState | null>(null)

  // Auto-fit viewport when new data arrives
  const prevDataLen = useState(0)
  if (data.length > 0 && data.length !== prevDataLen[0]) {
    prevDataLen[1](data.length)
    const lons = data.map((d) => d.geometry.coordinates[0])
    const lats = data.map((d) => d.geometry.coordinates[1])
    const minLon = Math.min(...lons)
    const maxLon = Math.max(...lons)
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    setViewState((v) => ({
      ...v,
      longitude: (minLon + maxLon) / 2,
      latitude: (minLat + maxLat) / 2,
      zoom: data.length === 1 ? 15 : 13,
      transitionDuration: 800,
      transitionInterpolator: new FlyToInterpolator(),
    }))
  }

  const handleClick = useCallback(
    (info: { object?: GeoJSONPoint; x: number; y: number }) => {
      if (info.object) {
        setPopup({ point: info.object, x: info.x, y: info.y })
      } else {
        setPopup(null)
      }
    },
    []
  )

  const layers = [
    new ScatterplotLayer<GeoJSONPoint>({
      id: 'locations',
      data,
      getPosition: (d) => d.geometry.coordinates,
      getRadius: 18,
      radiusUnits: 'pixels',
      getFillColor: [184, 115, 51, 220],  // warm amber rgba
      getLineColor: [230, 160, 80, 255],
      lineWidthMinPixels: 2,
      stroked: true,
      pickable: true,
      onClick: handleClick,
    }),
  ]

  return (
    <div className="map-view" onClick={() => setPopup(null)}>
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: vs }) => setViewState(vs as typeof INITIAL_VIEW)}
        controller={true}
        layers={layers}
      >
        <Map mapStyle={MAP_STYLE} />
      </DeckGL>
      {popup && (
        <MapPopup
          point={popup.point}
          x={popup.x}
          y={popup.y}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  )
}
```

```css
/* src/components/MapView.css */
.map-view {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.map-view canvas {
  outline: none;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MapView.tsx src/components/MapView.css
git commit -m "feat: add MapView with deck.gl ScatterplotLayer and click popup"
```

---

## Task 10: MessageBubble component

**Files:**
- Create: `src/components/MessageBubble.tsx`
- Create: `src/components/MessageBubble.css`

- [ ] **Step 1: Create MessageBubble**

```tsx
// src/components/MessageBubble.tsx
import type { Message } from '../types'
import './MessageBubble.css'

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
}

export function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  return (
    <div className={`message-bubble message-bubble--${isUser ? 'user' : 'assistant'}`}>
      {!isUser && (
        <div className="message-bubble__label">Nika</div>
      )}
      <div className="message-bubble__content">
        {message.content}
        {isStreaming && <span className="message-bubble__cursor" aria-hidden />}
      </div>
    </div>
  )
}
```

```css
/* src/components/MessageBubble.css */
.message-bubble {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  max-width: 88%;
}

.message-bubble--user {
  align-self: flex-end;
}

.message-bubble--assistant {
  align-self: flex-start;
}

.message-bubble__label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--accent);
  font-family: var(--font-ui);
  font-weight: 600;
  padding-left: var(--space-1);
}

.message-bubble__content {
  padding: var(--space-3) var(--space-4);
  border-radius: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.message-bubble--user .message-bubble__content {
  background: var(--accent-subtle);
  color: var(--text-primary);
  font-family: var(--font-ui);
  border-radius: 12px 12px 2px 12px;
}

.message-bubble--assistant .message-bubble__content {
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-family: var(--font-chat);
  font-size: 14px;
  border-radius: 2px 12px 12px 12px;
}

.message-bubble__cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: var(--accent);
  margin-left: 2px;
  vertical-align: middle;
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  50% { opacity: 0; }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MessageBubble.tsx src/components/MessageBubble.css
git commit -m "feat: add MessageBubble component with user/assistant styling"
```

---

## Task 11: ChatPanel component

**Files:**
- Create: `src/components/ChatPanel.tsx`
- Create: `src/components/ChatPanel.css`

- [ ] **Step 1: Create ChatPanel**

```tsx
// src/components/ChatPanel.tsx
import { useState, useRef, useEffect } from 'react'
import type { Message, GeoJSONPoint } from '../types'
import { MessageBubble } from './MessageBubble'
import { runAgentLoop } from '../services/agentLoop'
import './ChatPanel.css'

interface ChatPanelProps {
  onMapData: (points: GeoJSONPoint[]) => void
}

export function ChatPanel({ onMapData }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const query = input.trim()
    if (!query || isStreaming) return

    setInput('')
    setIsStreaming(true)
    setStreamingContent('')

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: query,
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, userMsg])

    abortRef.current = new AbortController()

    try {
      await runAgentLoop(
        query,
        messages,
        {
          onToken: (token) => setStreamingContent((prev) => prev + token),
          onAssistantMessage: (msg) => {
            setMessages((prev) => [...prev, msg])
            setStreamingContent('')
          },
          onToolCall: () => setStreamingContent(''),
          onMapData,
          onError: (err) => console.error('Agent error:', err),
        },
        abortRef.current.signal
      )
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error(err)
      }
    } finally {
      setIsStreaming(false)
      setStreamingContent('')
    }
  }

  return (
    <div className="chat-panel">
      <div className="chat-panel__header">
        <span className="chat-panel__title">Nika</span>
        <span className="chat-panel__subtitle">Your Singapore guide</span>
      </div>

      <div className="chat-panel__messages">
        {messages.length === 0 && (
          <div className="chat-panel__empty">
            <p>Ask me anything about places in Singapore.</p>
            <p className="chat-panel__empty-hint">Try: "Find ramen near Bugis" or "Parks in Punggol"</p>
          </div>
        )}
        {messages
          .filter((m) => m.role !== 'tool')
          .map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        {isStreaming && streamingContent && (
          <MessageBubble
            message={{ id: 'streaming', role: 'assistant', content: streamingContent, timestamp: Date.now() }}
            isStreaming
          />
        )}
        <div ref={bottomRef} />
      </div>

      <form className="chat-panel__form" onSubmit={handleSubmit}>
        <input
          className="chat-panel__input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about places in Singapore…"
          disabled={isStreaming}
          autoFocus
        />
        <button
          className="chat-panel__send"
          type="submit"
          disabled={isStreaming || !input.trim()}
          aria-label="Send"
        >
          {isStreaming ? '◼' : '↑'}
        </button>
      </form>
    </div>
  )
}
```

```css
/* src/components/ChatPanel.css */
.chat-panel {
  width: var(--sidebar-width);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border-left: 1px solid var(--border);
  height: 100vh;
}

.chat-panel__header {
  padding: var(--space-4) var(--space-4) var(--space-3);
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.chat-panel__title {
  font-family: var(--font-ui);
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.chat-panel__subtitle {
  font-size: 11px;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.chat-panel__messages {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.chat-panel__empty {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-8);
  color: var(--text-secondary);
  font-family: var(--font-chat);
  font-size: 14px;
  line-height: 1.6;
}

.chat-panel__empty-hint {
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--font-ui);
}

.chat-panel__form {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--border);
  align-items: flex-end;
}

.chat-panel__input {
  flex: 1;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: var(--space-2) var(--space-3);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: 13px;
  outline: none;
  resize: none;
  line-height: 1.5;
}

.chat-panel__input::placeholder { color: var(--text-muted); }
.chat-panel__input:focus { border-color: var(--accent-dim); }
.chat-panel__input:disabled { opacity: 0.5; }

.chat-panel__send {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--accent);
  color: oklch(0.12 0.01 60);
  border: none;
  cursor: pointer;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-weight: 700;
  transition: background 0.15s;
}

.chat-panel__send:hover:not(:disabled) { background: var(--accent-dim); }
.chat-panel__send:disabled { opacity: 0.4; cursor: not-allowed; }
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ChatPanel.tsx src/components/ChatPanel.css
git commit -m "feat: add ChatPanel with streaming messages and agent loop integration"
```

---

## Task 12: App root layout + wire-up

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace App.tsx**

```tsx
// src/App.tsx
import { useState } from 'react'
import { MapView } from './components/MapView'
import { ChatPanel } from './components/ChatPanel'
import type { GeoJSONPoint } from './types'
import './App.css'

export default function App() {
  const [mapData, setMapData] = useState<GeoJSONPoint[]>([])

  return (
    <>
      <MapView data={mapData} />
      <ChatPanel onMapData={setMapData} />
    </>
  )
}
```

- [ ] **Step 2: Run the app**

```bash
npm run tauri dev
```
Expected: Tauri window opens with full-width dark map on left and chat sidebar on right.

- [ ] **Step 3: Manual smoke test**

1. Type "Find coffee shops near Tanjong Pagar" → verify streaming response appears
2. Verify amber dots appear on the map at correct Singapore locations
3. Click a dot → verify popup shows name and address
4. Type a general question ("What is Bugis known for?") → verify no tool call, direct answer

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire up App layout — map + chat panel + agent loop"
```

---

## Task 13: Tauri config polish + CSP

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Update window title and CSP**

In `src-tauri/tauri.conf.json`, update:
```json
{
  "productName": "Nika Agent",
  "windows": [
    {
      "title": "Nika Agent",
      "width": 1200,
      "height": 800,
      "resizable": true
    }
  ],
  "security": {
    "csp": "default-src 'self'; connect-src 'self' http://localhost:11434 https://nominatim.openstreetmap.org https://fonts.googleapis.com https://fonts.gstatic.com https://basemaps.cartocdn.com https://*.tile.openstreetmap.org; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.tile.openstreetmap.org https://basemaps.cartocdn.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self'"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "chore: update Tauri window config and CSP for external APIs"
```

---

## Task 14: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README**

```markdown
# Nika AI Agent

A Tauri v2 desktop app that helps Nika employees discover hangout spots in Singapore using a locally-running Ollama LLM.

## Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (for Tauri)
- [Node.js](https://nodejs.org/) 18+
- [Ollama](https://ollama.ai/) running locally
- qwen2.5:14b model: `ollama pull qwen2.5:14b`

## Setup

```bash
npm install
npm run tauri dev
```

Ensure Ollama is running: `ollama serve`

## Architecture

**Model:** qwen2.5:14b via Ollama local HTTP API (`localhost:11434`)

**Agent loop:** Prompt-engineered JSON tool calling. The system prompt instructs the model to emit tool calls as fenced JSON blocks. The frontend parses these, executes the tool (Nominatim geocoding), and feeds the result back to the model for a final natural-language response.

**Why prompt-engineering over Ollama's native tools API?** qwen2.5:14b's native tool-call reliability is unverified. Prompt-engineering is transparent, debuggable, and model-agnostic.

**Map:** MapLibre GL JS (Carto Dark Matter base) + deck.gl ScatterplotLayer. Streaming via browser `fetch` ReadableStream — no Tauri Rust commands needed.

**Geocoding:** Nominatim (OpenStreetMap) — free, no API key. Note: Nominatim's usage policy requests max 1 req/sec, which interactive use naturally respects.

## Known Limitations

- No conversation persistence across sessions
- Nominatim results are OSM-quality (may miss some commercial venues)
- qwen2.5:14b occasionally produces off-format tool calls — the loop skips these and responds directly
- Map tiles require internet (OSM/Carto CDN)
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with architecture and setup instructions"
```

---

## Task 15: Write to sanjey.md

Throughout implementation, every task should add to `sanjey.md`. After all tasks are complete, do a final review to ensure all decisions are documented:

- [ ] **Final sanjey.md review**

Ensure `sanjey.md` contains entries for:
- Why prompt-engineered JSON over native tools API
- Why MapLibre + OSM over Carto
- Why direct fetch streaming over Tauri Rust commands
- Font choices (Bricolage Grotesque + Source Serif 4) and why those fonts
- Color palette choices and why warm amber over cyan/purple
- Any deviations from this plan and why

- [ ] **Commit**

```bash
git add sanjey.md
git commit -m "docs: complete sanjey.md decision log"
```

---

## Final Verification

- [ ] Run `npm test` — all tests pass
- [ ] Run `npm run tauri dev` — app opens
- [ ] Test: "Find ramen near Bugis" → streaming response + dots on map + popup on click
- [ ] Test: "Show parks in Punggol" → different neighbourhood, viewport auto-fits
- [ ] Test: "What is Tanjong Pagar known for?" → no tool call, direct conversational answer
- [ ] Test: Click a map marker → popup with name and address
