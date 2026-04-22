# Nika AI Agent

A Tauri v2 desktop app that helps Nika employees discover hangout spots in Singapore using a locally-running Ollama LLM. No cloud API keys. No subscriptions. Runs entirely on your machine.

---

## Model Choice — `qwen2.5:14b`

**Model:** Alibaba Qwen 2.5 at 14 billion parameters, served via Ollama.

**Why this model:**

| Model | Instruction following | Structured JSON output | Local size |
|---|---|---|---|
| `llama3.1:8b` | Good | Inconsistent | ~5 GB |
| `mistral:7b` | Moderate | Weak | ~4 GB |
| **`qwen2.5:14b`** | **Strong** | **Reliable** | **~9 GB** |
| `qwen2.5:72b` | Best | Best | Too large |

The agent loop depends on the model reliably emitting fenced JSON blocks for tool calls (```` ```json {"tool_call": ...} ``` ````). At 7–8B, models frequently deviate from the format under conversation context. Qwen 2.5 at 14Bolfollows the system prompt contract consistently and handles Singapore-specific knowledge well. The 14B size fits in 10–12 GB VRAM (RTX 3060 12 GB, M-series Mac unified memory) with acceptable token-per-second speed.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Tauri Desktop Shell                     │
│  ┌──────────────────────────────┐  ┌──────────────────────┐ │
│  │        Map Panel             │  │     Chat Panel       │ │
│  │  MapLibre GL JS (base map)   │  │  ChatPanel.tsx       │ │
│  │  deck.gl ScatterplotLayer    │  │  MessageBubble.tsx   │ │
│  │  MapPopup.tsx (click info)   │  │  streaming tokens    │ │
│  └──────────┬───────────────────┘  └──────────┬───────────┘ │
│             │ GeoJSONPoint[]                   │ user query  │
│             └──────────────┬──────────────────┘             │
│                            │                                 │
│                    ┌───────▼────────┐                        │
│                    │   agentLoop.ts │                        │
│                    │  (tool router) │                        │
│                    └───────┬────────┘                        │
│           ┌────────────────┼──────────────────┐              │
│           ▼                ▼                  ▼              │
│   ollamaService.ts  localSearchService.ts   types/           │
│   streaming fetch   bundled SG POI data     index.ts         │
│           │                │                                  │
│           ▼                ▼                                  │
│    Ollama HTTP API    singaporePois.ts                        │
│    localhost:11434    (~100 curated places)                   │
└─────────────────────────────────────────────────────────────┘
```

**Agent loop flow:**

1. User types a query → `runAgentLoop` sends it to Ollama via streaming `fetch`
2. Tokens stream in; text before any JSON block is forwarded to the UI token-by-token
3. When the full response arrives, `extractToolCall` checks for a fenced JSON block:
   ```json
   {"tool_call": {"name": "location_search", "args": {"query": "ramen", "near": "Bugis"}}}
   ```
4. If a tool call is found: execute `localSearchService.searchLocations`, feed results back to Ollama as a `tool` message, stream the final natural-language answer
5. `GeoJSONPoint[]` results are lifted to `App.tsx` via `onMapData` callback → `MapView` renders `ScatterplotLayer` pins and flies the viewport to fit them

**Key design decisions** (full reasoning in `sanjey.md`):
- Prompt-engineered JSON tool calls rather than Ollama's native tools API — transparent, debuggable, model-agnostic
- Direct `fetch` streaming from the renderer — no Tauri IPC proxy needed for a localhost service
- `useState` + prop callbacks — the component tree is three nodes deep; Redux/Context would be over-engineering
- Bundled Singapore POI dataset instead of Nominatim — eliminates the last external HTTP call; fully offline
- PMTiles protocol for map tiles — single-file tile archive served from `public/`; no tile server needed

---

## Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (stable, for Tauri)
- [Node.js](https://nodejs.org/) 18+
- [Ollama](https://ollama.ai/) installed and running

**Windows only:** requires [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (pre-installed on Windows 11; download from Microsoft if missing on Windows 10).

---

## Install and Run

```bash
# 1. Clone the repo
git clone <repo-url>
cd nika_aiagent

# 2. Pull the model (one-time, ~9 GB download)
ollama pull qwen2.5:14b

# 3. Start Ollama (if not already running as a service)
ollama serve

# 4. Install JS dependencies
npm install

# 5. Launch the app
npm run tauri dev
```

The Tauri window opens automatically. Type a query like **"Find ramen near Bugis"** or **"Parks in Punggol"** to start.

### Optional: Offline Map Tiles

The app works without map tiles (markers render on a plain dark background). For a full vector base map, download the Singapore PMTiles file and place it in `public/`:

```bash
# ~60 MB — Singapore region extract
curl -L "https://r2-public.protomaps.com/protomaps-sample-datasets/protomaps-basemap-opensource-20230408.pmtiles" \
  -o public/singapore.pmtiles
```

The app detects the file automatically on next launch — no config change needed.

---

## Running Tests

```bash
npm test
```

9 Vitest unit tests cover `extractToolCall`, `formatToolResult`, and the local search service.

---

## Known Limitations and Trade-offs

| Limitation | Detail |
|---|---|
| **Bundled POI dataset** | Location search covers ~100 curated Singapore places. Obscure venues, new openings, or street addresses won't be found. Nominatim (live OSM) would give full coverage but requires internet. |
| **Map base tiles require download** | The PMTiles file (~60 MB) is not bundled in the repo. Without it, the map shows a plain dark background. Markers and popups still work fully. |
| **No conversation persistence** | Chat history is in-memory only. Restarting the app clears all messages. |
| **Response speed** | `qwen2.5:14b` generates ~15–25 tokens/sec on a modern GPU. On CPU-only machines it is significantly slower. A smaller model (e.g. `qwen2.5:7b`) can be swapped in `ollamaService.ts` for faster responses at some quality cost. |
| **Single tool** | Only `location_search` is implemented. The tool registry (`src/tools/registry.ts`) is designed for extension — additional tools (e.g. directions, opening hours) can be added without changing the agent loop. |
| **Map labels require internet** | The offline PMTiles style omits text labels (they need font glyphs from a CDN). Roads, water, buildings, and parks render offline; place names do not. |
