# Sanjey's Decision Log — Nika AI Agent

> Every decision, design choice, and trade-off made while building the Nika AI Agent.
> Written as the project was built, with code chunks tagged to thoughts.

---

## 1. Agent Loop Approach — Prompt-Engineered JSON Parsing over Ollama's Native Tools API

**What was chosen:** The agent loop detects tool calls by parsing fenced JSON blocks (` ```json ``` `) from the model's text output, rather than using Ollama's native `tools` parameter in the `/api/chat` request body.

**Trade-offs considered:**

| Option | Pros | Cons |
|---|---|---|
| Ollama native tools API | Structured, no regex, guaranteed format | Not all models support it reliably; `qwen2.5:14b` tool-calling via Ollama can silently fall back to text |
| Prompt-engineered JSON blocks | Works on any model, fully transparent, easy to test and debug | Requires the model to follow a specific output format; malformed JSON must be handled gracefully |

**Why this choice:** The assignment specifies `qwen2.5:14b` and local Ollama. Qwen 2.5 does support Ollama's tool schema, but the native implementation adds an extra abstraction layer that hides what the model is actually generating — harder to debug and harder to test deterministically. Prompt-engineering the format gives complete control: the system prompt defines exactly what the block must look like, and `extractToolCall` in `agentLoop.ts` uses a single regex + `JSON.parse` to detect it. It also means any open-weight model can be swapped in without changing a line of infrastructure code.

**Relevant code — `src/services/agentLoop.ts`:**
```ts
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
```

**Relevant code — `src/services/ollamaService.ts` (system prompt excerpt):**
```ts
// The system prompt instructs the model in plain language:
// "To call a tool, output ONLY a JSON code block like this..."
// This is the contract between the prompt and extractToolCall().
```

---

## 2. Base Map Choice — MapLibre GL JS + deck.gl + OpenStreetMap/Carto

**What was chosen:** `react-map-gl` (wrapping MapLibre GL JS) as the base map renderer, with `deck.gl`'s `ScatterplotLayer` for the location pins, using the Carto Dark Matter tile style over OpenStreetMap data.

**Trade-offs considered:**

| Option | Pros | Cons |
|---|---|---|
| Mapbox GL JS | Polished, well-documented | Requires API key, proprietary, costs money |
| Leaflet + React-Leaflet | Lightweight, widely known | No WebGL, no smooth 3D transitions, raster tiles look dated |
| MapLibre GL JS (open-source Mapbox fork) | Free, open-source, WebGL, same API surface as Mapbox | Slightly less documentation than Mapbox itself |
| Google Maps JS API | Familiar to users | API key required, usage fees, no control over style |

**Why this choice:** MapLibre is the obvious pick for a local-first app that must work without internet auth or API keys. The Carto Dark Matter style (`basemaps.cartocdn.com`) is freely available, renders beautifully on dark UIs, and matches the warm-dark colour palette without any visual conflict. deck.gl adds high-performance WebGL overlays with `FlyToInterpolator` for smooth animated viewport transitions when new search results arrive — something impossible with plain Leaflet.

**Relevant code — `src/components/MapView.tsx`:**
```ts
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

// FlyTo animation fires whenever new data arrives
setViewState((v) => ({
  ...v,
  longitude: (minLon + maxLon) / 2,
  latitude: (minLat + maxLat) / 2,
  zoom: data.length === 1 ? 15 : 13,
  transitionDuration: 800,
  transitionInterpolator: new FlyToInterpolator(),
}))
```

---

## 3. Streaming Approach — Direct `fetch` from the Renderer over Tauri Rust Commands

**What was chosen:** The Ollama API is called directly from the React renderer process using the browser's native `fetch` API and `ReadableStream`, rather than routing the request through a Tauri Rust command via `invoke`.

**Trade-offs considered:**

| Option | Pros | Cons |
|---|---|---|
| Direct fetch from renderer | Simple, no Rust involved, streaming works natively with `getReader()`, easy to test | Bypasses Tauri's IPC layer; doesn't benefit from Rust's HTTP client |
| Tauri `invoke` to Rust `reqwest` | Keeps network calls in Rust, could add retry logic or auth at Rust layer | Requires writing a Tauri command, streaming over IPC is complex (Tauri events for each chunk), adds latency, much harder to test |

**Why this choice:** Ollama runs on `localhost:11434` — there is no cross-origin issue, no auth, and no reason to proxy through Rust. Direct `fetch` with a `ReadableStream` reader is the simplest path to per-token streaming UI updates. Tauri's IPC streaming (`emit` events from Rust to frontend) adds significant boilerplate with no payoff for a local service. The streaming loop is 20 lines of clean TypeScript that is easy to mock in tests.

**Relevant code — `src/services/ollamaService.ts`:**
```ts
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
```

---

## 4. Model Choice — `qwen2.5:14b`

**What was chosen:** Alibaba's Qwen 2.5 at 14B parameters, served locally via Ollama.

**Trade-offs considered:**

| Model | Pros | Cons |
|---|---|---|
| `llama3.1:8b` | Small, fast | Weaker instruction following for structured output |
| `mistral:7b` | Lightweight | Less context, weaker tool-format adherence |
| `qwen2.5:14b` | Strong instruction following, good at structured JSON output, decent speed on consumer GPU | ~9GB VRAM, slower than 7B models |
| `qwen2.5:72b` | Best quality | Too large for most local machines |

**Why this choice:** Specified by the assignment. In practice, Qwen 2.5 at 14B is an excellent fit: it reliably follows the system prompt's JSON format instruction, rarely hallucinates the tool-call structure, and handles Singapore-specific knowledge well. The 14B size is a sweet spot — fits in 10–12GB VRAM (RTX 3060 12GB / M-series Mac) while producing output quality noticeably better than 7B models for structured generation tasks.

**Relevant code — `src/services/ollamaService.ts`:**
```ts
const MODEL = 'qwen2.5:14b'
```

---

## 5. Font Choices — Bricolage Grotesque (UI) + Source Serif 4 (Chat)

**What was chosen:** Two Google Fonts:
- **Bricolage Grotesque** — variable grotesque sans-serif for all UI chrome (headers, labels, inputs, buttons)
- **Source Serif 4** — variable optical-size serif for chat message text

**Trade-offs considered:**

For UI chrome:
- Inter / Geist / system-ui → safe but generic; Bricolage Grotesque has optical-size axis and a warm quirkiness that feels less corporate and more guide-like
- Bricolage Grotesque → the optical-size variation (`opsz` axis from 12–96) means it reads cleanly at 11px label size and looks characterful at 16px heading size from the same font

For chat:
- Using the same sans-serif as the UI → readable but flat; chat messages are conversational prose
- Source Serif 4 → an optical-size variable serif that renders beautifully at body text sizes; the serif texture signals "this is reading content" vs. "this is UI", creating a natural visual hierarchy without any colour change

**Why this choice:** The two-font pairing creates a clear semantic split: Bricolage Grotesque = navigation/chrome/action, Source Serif 4 = reading/conversation. Both are variable fonts, so a single HTTP request covers the full weight and size range. The serif in chat also subtly recalls travel guides and editorial writing — appropriate for an AI described as a "knowledgeable local guide."

**Relevant code — `src/App.css`:**
```css
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300..800&family=Source+Serif+4:ital,opsz,wght@0,8..60,300..900;1,8..60,300..900&display=swap');

:root {
  --font-ui:   'Bricolage Grotesque', system-ui, sans-serif;
  --font-chat: 'Source Serif 4', Georgia, serif;
}
```

---

## 6. Color Palette — Dark Warm Charcoal + Amber Accent (OKLCH)

**What was chosen:** All colours defined in `oklch()`, using hue ~60 (warm charcoal) for backgrounds and neutrals, and hue ~55 (amber) for the accent.

**Trade-offs considered:**

| Palette direction | Feel | Fit for this project |
|---|---|---|
| Cool dark + cyan (hue 200) | Technical, developer-tool, cold | Wrong for a "warm local guide" persona |
| Dark + purple/indigo (hue 280) | AI-product, trendy | Generic, impersonal |
| Dark + amber/gold (hue 55) | Warm, editorial, welcoming | Matches Singapore's food-culture warmth; amber = golden hour, hawker lights |
| Pure black + white | Minimal | No personality |

**Why OKLCH instead of hex/HSL:** OKLCH is perceptually uniform — `oklch(0.72 0.14 55)` for accent means lightness is predictable (0.72 is always medium-light regardless of hue). When mixing accent-subtle variants at `oklch(0.25 0.05 55)`, the relationship between steps is visually consistent, which is impossible to guarantee in HSL. Every token in the palette steps predictably.

**Why warm over cool:** The product is a guide to Singapore — food, hawker centres, neighbourhood life. Amber reads as warmth, hospitality, and early-evening light. A cyan or purple accent would undercut that feeling and make the app feel like a generic AI tool rather than a place-specific companion.

**Relevant code — `src/App.css`:**
```css
:root {
  /* Backgrounds — warm charcoal, OKLCH hue ~60 */
  --bg-base:       oklch(0.12 0.01 60);
  --bg-surface:    oklch(0.16 0.012 60);
  --bg-elevated:   oklch(0.21 0.015 60);

  /* Accent — amber, OKLCH hue ~55 */
  --accent:        oklch(0.72 0.14 55);
  --accent-dim:    oklch(0.50 0.10 55);
  --accent-subtle: oklch(0.25 0.05 55);
}
```

The map pin fill colour in `MapView.tsx` (`[184, 115, 51, 220]`) was hand-matched to `--accent` in RGB space to keep the overlay dots visually consistent with the sidebar.

---

## 7. Chat Layout — Right Sidebar (320px Fixed) over Bottom Drawer or Floating Overlay

**What was chosen:** A fixed 320px right-side panel that occupies full viewport height, with the map filling the remaining width. The layout is a flex row: `map | chat`.

**Trade-offs considered:**

| Layout | Pros | Cons |
|---|---|---|
| Bottom drawer (40% height) | Familiar mobile pattern | Obscures most of the map when open; map and chat can't be seen simultaneously |
| Floating overlay (top-right bubble → expansion) | Map always full-screen | Clutters the map; hard to read conversation while looking at pins |
| Left sidebar | Works | Convention for primary nav; chat is secondary, so right feels more natural |
| Right sidebar 320px fixed | Map and chat always visible simultaneously; user can pan map while reading response | Fixed width not responsive below ~600px viewport |

**Why this choice:** The core interaction pattern is: ask question → watch pins appear on map → read the agent's description. This requires simultaneous visibility of map and chat. A bottom drawer or overlay forces the user to toggle between views. 320px is the minimum width for comfortable chat reading (prevents line wrapping below ~5 words per line) while leaving the map with at least ~700px on a 1024px screen. Tauri targets desktop, so responsive mobile breakpoints are deprioritised.

**Relevant code — `src/App.css`:**
```css
#root {
  width: 100vw;
  height: 100vh;
  display: flex;   /* row direction — map fills flex:1, chat is flex-shrink:0 */
}
```

**`src/App.css` (custom property):**
```css
--sidebar-width: 320px;
```

**`src/components/ChatPanel.css`:**
```css
.chat-panel {
  width: var(--sidebar-width);
  flex-shrink: 0;
  height: 100vh;
}
```

---

## 8. Tool Call Format — Fenced JSON Blocks (` ```json {...}``` `)

**What was chosen:** The model is instructed to emit tool calls as Markdown fenced code blocks with the `json` language tag, containing a single JSON object with a `tool_call` key.

**Trade-offs considered:**

| Format | Detection | Reliability | Readability |
|---|---|---|---|
| XML tags `<tool_call>...</tool_call>` | XML parse or regex | Good; some models prefer this | Fine |
| Bare JSON `{"tool_call": ...}` on its own line | Regex/JSON.parse | Fragile — any prose before/after breaks it | Poor |
| Custom delimiter `[TOOL]...[/TOOL]` | Simple regex | Model must remember novel delimiter | Poor |
| Fenced ` ```json ``` ` block | Single regex + JSON.parse | Models reliably produce Markdown code fences when instructed; common in training data | Excellent — humans can read it in raw output |

**Why this choice:** Fenced code blocks appear constantly in LLM training data (GitHub, StackOverflow, documentation). Qwen 2.5 is highly reliable at producing them when instructed. The `extractToolCall` regex is four lines. If the model adds conversational text before or after the block, the regex still finds the block. The `json` tag makes the intent clear to any developer reading raw output in the terminal or logs.

**Relevant code — `src/services/agentLoop.ts`:**
```ts
const match = text.match(/```json\s*([\s\S]*?)\s*```/)
```

**System prompt contract (in `src/services/ollamaService.ts`):**
```
To call a tool, output ONLY a JSON code block like this (nothing before or after):

```json
{"tool_call": {"name": "location_search", "args": {"query": "<what to search>", "near": "<area in Singapore>"}}}
```
```

---

## 9. State Management — Simple `useState` in `App.tsx` over Context or Redux

**What was chosen:** All shared state (map data passed from chat to map) flows via a single `onMapData` prop callback from `App.tsx` into `ChatPanel`, which calls it to lift `GeoJSONPoint[]` up to `App`, which passes the array down to `MapView`. No Context, no Redux, no Zustand.

**Trade-offs considered:**

| Approach | Complexity | Appropriate for |
|---|---|---|
| Redux / Redux Toolkit | High | Large apps with many slices of global state and async middleware |
| React Context + useReducer | Medium | Mid-size apps, global theme/auth state |
| Zustand / Jotai | Low–Medium | Apps where prop drilling becomes painful |
| `useState` + prop callbacks | Minimal | Small apps with 2–3 components and 1–2 shared values |

**Why this choice:** The component tree is exactly three nodes deep: `App` → `ChatPanel` and `App` → `MapView`. The only cross-component state is `mapData: GeoJSONPoint[]`. One `useState` and one callback prop is the entire data flow. Adding Context or Redux here would be engineering for a problem that doesn't exist — it would triple the state-related code for no user-facing benefit. If the app grows (history persistence, multiple map layers, user settings), Zustand would be the first upgrade.

**Relevant code — `src/App.tsx`:**
```tsx
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

---

## 10. TypeScript Approach — All Types in `types/index.ts`, No `any`

**What was chosen:** A single `src/types/index.ts` file exports every shared interface and type. No `any` is used anywhere in the codebase. All Nominatim API responses, Ollama message shapes, GeoJSON structures, and tool definitions are typed explicitly.

**Trade-offs considered:**

- **Inline types (define at point of use):** Fast to write, but types get duplicated across files and drift from each other over time.
- **Per-module types (co-located):** Reasonable for large codebases where modules are independently versioned, but adds friction for a 5-file service layer.
- **Centralised `types/index.ts`:** Single source of truth; any change to a shared shape is immediately caught everywhere; easy for a new contributor to understand the data model in one read.

**Why no `any`:** `any` is a type system escape hatch that removes compiler guarantees exactly where they're most valuable — at the boundaries between the LLM output (untyped JSON) and the rest of the app. `NominatimResult` and `OllamaMessage` define the exact shapes expected from external APIs. If an API response changes shape, TypeScript catches it at the parse site rather than at runtime in a user-facing error.

**Relevant code — `src/types/index.ts`:**
```ts
export interface NominatimResult {
  display_name: string
  lat: string
  lon: string
  type: string
  name?: string
}

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
}

export interface GeoJSONPoint {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: { name: string; displayName: string; type?: string }
}
```

Tuple type `[number, number]` for coordinates enforces that `coordinates` is always exactly `[longitude, latitude]` — not a general number array that could accidentally receive 3D coordinates.

---

## 11. Testing Approach — Vitest for Services, Manual for UI/Map

**What was chosen:** Automated unit tests with Vitest cover the two pure service modules: `agentLoop.ts` (tool call parsing and result formatting) and `nominatimService.ts` (HTTP fetch, GeoJSON mapping). The React UI components and MapLibre/deck.gl map are tested manually.

**Trade-offs considered:**

| Layer | Automated tests? | Reason |
|---|---|---|
| `agentLoop.ts` — `extractToolCall`, `formatToolResult` | Yes — Vitest unit tests | Pure functions; easy to test; correctness is critical (wrong parse = broken tool dispatch) |
| `nominatimService.ts` — `searchLocations` | Yes — Vitest with `vi.fn()` mock for `fetch` | Network boundary; need to verify URL construction, GeoJSON mapping, empty-result handling |
| `ollamaService.ts` — streaming | No | Streaming over a live LLM is integration-test territory; mocking a streaming `ReadableStream` is complex with diminishing returns |
| `ChatPanel.tsx` — UI state, form, streaming display | Manual | React Testing Library + streaming is fragile; component has no logic that isn't already tested at the service layer |
| `MapView.tsx` — deck.gl, MapLibre | Manual | WebGL context not available in jsdom; deck.gl requires a canvas, making automated tests impractical without a real browser |

**Why Vitest specifically:** Vitest is the natural companion to Vite — it shares the same config, supports ESM natively without transform config, and is already in the devDependencies. Jest with Babel/TS transforms would require additional configuration to handle Vite's module resolution and ESM imports.

**Relevant code — `tests/agentLoop.test.ts`:**
```ts
it('detects a tool call JSON block', () => {
  const text = `\`\`\`json\n{"tool_call": {"name": "location_search", "args": {"query": "ramen", "near": "Bugis"}}}\n\`\`\``
  const result = extractToolCall(text)
  expect(result!.name).toBe('location_search')
  expect(result!.args.query).toBe('ramen')
})
```

**Relevant code — `tests/nominatimService.test.ts`:**
```ts
beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => mockNominatimResponse,
  } as Response)
})
```

The fetch mock covers the network boundary cleanly without needing `msw` or `nock`, keeping the test setup to a single `beforeEach` call.

---

*Last updated: 2026-04-20*
