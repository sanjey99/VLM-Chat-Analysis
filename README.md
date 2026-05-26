# VLM Chat Analysis

A Tauri 2 desktop app for video understanding. Upload a video, choose a vision-language model, and ask questions about its content. Responses stream token-by-token from a local Python backend — no cloud API keys required.

---

## Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2 |
| Frontend | React 19 + TypeScript 5.8 + Vite 7 |
| Backend | FastAPI + Uvicorn (Python) |
| Inference | HuggingFace `transformers` + PyTorch |
| Frame extraction | `decord` |
| Streaming | Server-Sent Events (SSE) |

---

## Models

Four models are available in the selector. All are Apache-2.0 licensed and run entirely on your machine.

| Model | VRAM (BF16) | Notes |
|---|---|---|
| Qwen3-VL 2B | ~6 GB | Fastest; good for quick queries |
| Qwen3-VL 4B | ~10 GB | Balanced speed and quality |
| Qwen3-VL 8B | ~18 GB | Best quality; needs ≥20 GB VRAM |
| Gemma 4 E4B | ~10 GB | Google alternative; MoE architecture |

The default model on startup is **Qwen3-VL 2B**. Models are downloaded automatically from HuggingFace Hub on first use.

---

## Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (stable)
- [Node.js](https://nodejs.org/) 18+
- Python 3.10+
- A CUDA-capable GPU with ≥8 GB VRAM (CPU inference works but is very slow)

---

## Install and Run

### 1. Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --port 8000
```

The backend starts on `http://localhost:8000`. On first launch it downloads and loads the default model (Qwen3-VL 2B). Use `GET /health` to check when it is ready.

### 2. Frontend

```bash
npm install
npm run tauri dev
```

The Tauri window opens automatically. Select a model, wait for it to load, upload a video, and start chatting.

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│                  Tauri Desktop Shell             │
│  ┌────────────────────────────────────────────┐  │
│  │  ModelSelector  VideoUpload/Preview        │  │
│  │           ChatPanel                        │  │
│  │  (SSE token stream → MessageBubble)        │  │
│  └──────────────────┬─────────────────────────┘  │
│                     │ fetch / SSE                 │
└─────────────────────┼───────────────────────────┘
                      │ localhost:8000
┌─────────────────────┼───────────────────────────┐
│  FastAPI Backend    │                            │
│  ┌──────────────────▼─────────────────────────┐  │
│  │  POST /chat/stream (SSE)                   │  │
│  │  POST /upload                              │  │
│  │  GET  /models                              │  │
│  │  POST /load-model  (non-blocking)          │  │
│  │  GET  /system/info (GPU + VRAM)            │  │
│  └─────┬──────────────────┬───────────────────┘  │
│        │                  │                       │
│   video_utils.py      vlm.py                     │
│   (decord frames)     QwenAdapter / GemmaAdapter  │
│                       TextIteratorStreamer         │
└──────────────────────────────────────────────────┘
```

**Request flow:**

1. User selects a model → `POST /load-model` fires a background thread; frontend polls `GET /system/info` every 1.5 s until `ready: true`
2. User uploads a video → `POST /upload` saves the file, returns `video_id`
3. User sends a message → `POST /chat/stream` extracts frames with `decord`, runs the VLM, streams tokens via SSE
4. Tokens arrive as `data: {"token": "..."}` events and are appended to the streaming bubble

---

## Configuration

Per-model settings (resolution, FPS, max frames, quantization) live in `backend/config.py` under `MODEL_REGISTRY`. To add a new model, add an entry and implement or reuse an adapter in `backend/vlm.py`.

The frontend backend URL is set in `src/services/vlmService.ts`:

```ts
const BACKEND = 'http://localhost:8000'
```

---

## Running Tests

```bash
npm test
```
