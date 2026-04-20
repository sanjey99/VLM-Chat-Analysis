# Nika AI Agent

A Tauri v2 desktop app that helps Nika employees discover hangout spots in Singapore using a locally-running Ollama LLM — no cloud API keys, no subscriptions.

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

Ensure Ollama is running before starting: `ollama serve`

## Running Tests

```bash
npm test
```

## Architecture

**Model:** qwen2.5:14b via Ollama local HTTP API (`localhost:11434`)

**Agent Loop:** Prompt-engineered JSON tool calling. The system prompt instructs the model to emit tool calls as fenced JSON blocks:
```json
{"tool_call": {"name": "location_search", "args": {"query": "ramen", "near": "Bugis"}}}
```
The frontend parses these, executes the tool (Nominatim geocoding), feeds the result back, and the model generates a final natural-language response.

**Why prompt-engineering over Ollama's native tools API?** qwen2.5:14b's native tool-call reliability is unverified locally. Prompt-engineering is transparent, debuggable, and model-agnostic — any model that follows instructions works.

**Streaming:** Browser `fetch` ReadableStream reads Ollama's SSE response token-by-token. No Tauri Rust commands needed — the assignment explicitly permits direct fetch from the renderer.

**Map:** MapLibre GL JS (Carto Dark Matter base tiles) + deck.gl ScatterplotLayer for location markers. Results auto-fit the viewport on arrival.

**Geocoding:** Nominatim (OpenStreetMap) — free, no API key required. Nominatim's usage policy requests max 1 req/sec; interactive use naturally respects this.

## Project Structure

```
src/
├── types/index.ts              # Shared TypeScript interfaces
├── tools/registry.ts           # Tool definitions (location_search)
├── services/
│   ├── ollamaService.ts        # Streaming fetch to Ollama + system prompt
│   ├── agentLoop.ts            # Tool-calling loop: send → parse → execute → feed back
│   └── nominatimService.ts     # Nominatim API → GeoJSON points
└── components/
    ├── MapView.tsx             # deck.gl + MapLibre map, markers, popup
    ├── ChatPanel.tsx           # Chat sidebar with streaming messages
    ├── MessageBubble.tsx       # User/assistant message styling
    └── MapPopup.tsx            # Click tooltip on markers
```

## Known Limitations

- No conversation persistence across sessions (in-memory only)
- Nominatim results are OSM-quality (may miss some commercial venues)
- qwen2.5:14b occasionally produces off-format tool calls — the loop handles this gracefully by returning the direct response
- Map base tiles require internet (Carto CDN)
- Tested with qwen2.5:14b; other models may need system prompt tuning
