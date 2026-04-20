# Nika AI Agent — Design Spec
**Date:** 2026-04-20  
**Status:** Approved

---

## 1. Problem & Users

Nika employees want to discover hangout spots around Singapore. They need a way to ask natural-language questions ("find ramen near Bugis", "parks in Punggol") and see results on an interactive map — all running locally, no cloud API keys, no subscriptions.

---

## 2. Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Desktop shell | Tauri v2 | Required by assignment |
| Frontend | React + TypeScript | Required by assignment |
| Local LLM | Ollama (qwen2.5:14b) | Required; runs fully on-device |
| Map rendering | deck.gl + MapLibre GL JS | Required; MapLibre for base tiles (OSM, free, offline-capable) |
| Geocoding | Nominatim (OpenStreetMap) | Required; free, no key |

---

## 3. Architecture

### Project Structure
```
src/
├── App.tsx                    # Root layout: MapView (70%) + ChatPanel sidebar (30%)
├── components/
│   ├── MapView.tsx            # deck.gl + MapLibre base map, renders layers
│   ├── ChatPanel.tsx          # Scrollable history + input box
│   ├── MessageBubble.tsx      # User vs agent message styling
│   └── MapPopup.tsx           # Click tooltip on map markers
├── services/
│   ├── ollamaService.ts       # Streaming fetch to localhost:11434, system prompt
│   ├── agentLoop.ts           # Full tool-calling loop: send → parse → execute → feed back
│   └── nominatimService.ts    # location_search tool: calls Nominatim, returns GeoJSON
├── tools/
│   └── registry.ts            # Tool definitions as TypeScript types + JSON schema
└── types/
    └── index.ts               # All shared interfaces (Message, ToolCall, LocationResult, etc.)
```

### Data Flow
```
User query
  → agentLoop.ts sends to Ollama with system prompt + tool registry
  → Ollama streams tokens → rendered live in ChatPanel
  → If stream contains tool_call JSON block → parse → call Nominatim
  → Tool result injected as next message → Ollama generates final response
  → GeoJSON points → new deck.gl ScatterplotLayer → viewport auto-fits
```

---

## 4. Key Design Decisions

### 4.1 Agent Loop: Prompt-engineered JSON parsing
The system prompt instructs qwen2.5:14b to emit tool calls as a JSON fenced block when it needs to invoke a tool:
```
```json
{"tool_call": {"name": "location_search", "args": {"query": "ramen", "near": "Bugis, Singapore"}}}
```
```
The frontend parses this with a regex scan over the accumulated stream. If found, execution pauses, the tool runs, and the result is injected as a `tool` role message before continuing generation.

**Why not Ollama's native tools API?** The native API's reliability with qwen2.5:14b is unverified locally. Prompt-engineering is transparent, debuggable, and model-agnostic.

### 4.2 Streaming: Direct fetch from renderer
The React frontend calls `fetch('http://localhost:11434/api/chat')` directly and reads the response via `ReadableStream` + `TextDecoder`. No Tauri Rust commands needed. The assignment explicitly permits this approach.

### 4.3 Base map: MapLibre GL JS + OSM
Free, open-source, works offline with cached tiles, integrates cleanly with deck.gl via `@deck.gl/mapbox` interop. No API key required.

---

## 5. TypeScript Interfaces

```typescript
// All in types/index.ts
interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: number
}

interface ToolCall {
  name: string
  args: Record<string, string>
}

interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, { type: string; description: string }>
    required: string[]
  }
}

interface LocationResult {
  name: string
  lat: number
  lon: number
  displayName: string
  type?: string
}

interface GeoJSONPoint {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: { name: string; displayName: string; type?: string }
}

interface AgentLoopState {
  messages: Message[]
  isStreaming: boolean
  mapLayers: GeoJSONPoint[]
}
```

---

## 6. Required Tool

### `location_search`
```typescript
{
  name: 'location_search',
  description: 'Search for locations, venues, or places in Singapore using natural language. Returns GeoJSON points suitable for map rendering.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to search for (e.g. "ramen restaurants", "parks", "coffee shops")' },
      near: { type: 'string', description: 'Area or neighbourhood in Singapore (e.g. "Bugis", "Tanjong Pagar")' }
    },
    required: ['query']
  }
}
```

Nominatim query: `https://nominatim.openstreetmap.org/search?q={query} near {near}, Singapore&format=json&limit=10`

---

## 7. Design System

### Palette (dark mode, warm)
```css
--bg-base:     oklch(0.12 0.01 60);   /* deep warm charcoal */
--bg-surface:  oklch(0.16 0.012 60);  /* sidebar + panels */
--bg-elevated: oklch(0.20 0.014 60);  /* input, cards */
--accent:      oklch(0.72 0.14 55);   /* warm amber */
--accent-dim:  oklch(0.50 0.10 55);   /* muted amber for hover */
--text-primary:   oklch(0.92 0.01 60);
--text-secondary: oklch(0.55 0.01 60);
```

### Typography
- **UI elements**: Bricolage Grotesque (Google Fonts) — variable, warm, editorial character
- **Chat messages**: Source Serif 4 — readable, warm, feels handwritten by a friend

### Layout
- Map: `flex: 1` (takes remaining width after sidebar)
- Sidebar: fixed `320px`, dark warm surface, no heavy border — subtle 1px separator
- Chat messages: agent left-aligned, user right-aligned with amber pill background
- No chat bubble tails — flat rounded rectangles only

### Banned patterns
- No gradient text
- No side-stripe card borders (border-left > 1px)
- No glassmorphism
- No neon/cyan accents
- No generic AI chat bubble aesthetic

---

## 8. Part-to-File Mapping

| Assignment Part | Implementation |
|-----------------|----------------|
| Part 1: Ollama service + system prompt | `services/ollamaService.ts` |
| Part 2: Tauri app + React layout | `App.tsx`, `components/` |
| Part 3: Tool-calling loop | `services/agentLoop.ts`, `tools/registry.ts` |
| Part 4: deck.gl map + popups | `components/MapView.tsx`, `components/MapPopup.tsx` |
| Part 5: Streaming SSE | `services/ollamaService.ts` (ReadableStream) |

---

## 9. Known Constraints & Risks

1. **qwen2.5:14b JSON adherence** — model may occasionally deviate from the tool-call format. Mitigation: robust regex that scans the full streamed response, not just the final chunk.
2. **Nominatim rate limits** — 1 req/sec policy. Not an issue for interactive use but should add a note in README.
3. **MapLibre + deck.gl interop** — requires careful layering (`DeckGL` component with `MapboxOverlay` or `Map` as base). Well-documented but version-sensitive.
4. **10-hour limit** — no auth, no persistence, no multi-session history. Scope is locked to the 5 parts.
