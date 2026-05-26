import asyncio
import json
import logging
import threading
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import torch
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from video_utils import extract_frames, get_duration, is_image, is_supported, load_image
from vlm import (
    current_model_id, generate_stream_timed, generate_base_stream_timed,
    get_base_model_id, is_loading, is_ready, is_base_loading, is_base_ready,
    load_model, load_base_model,
)
from config import DEFAULT_MODEL, DEFAULT_BASE_MODEL, MODEL_REGISTRY, BASE_MODEL_REGISTRY

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

_video_store: dict[str, dict] = {}


logging.basicConfig(level=logging.INFO)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load active model first, then base model — sequential to avoid VRAM contention.
    def load_sequence():
        load_model(DEFAULT_MODEL)
        load_base_model(DEFAULT_BASE_MODEL)

    threading.Thread(target=load_sequence, daemon=True).start()
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:1420", "tauri://localhost", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ready" if is_ready() else "loading"}


@app.get("/models")
async def list_models():
    return {
        "models": [
            {"id": mid, "label": cfg["label"], "input_type": cfg.get("input_type", "video")}
            for mid, cfg in MODEL_REGISTRY.items()
        ],
        "current": current_model_id(),
        "loading": is_loading(),
        "base_ready": is_base_ready(),
        "base_loading": is_base_loading(),
        "base_model": get_base_model_id(),
        "base_models": [
            {"id": mid, "label": cfg["label"]}
            for mid, cfg in BASE_MODEL_REGISTRY.items()
        ],
    }


class LoadBaseModelRequest(BaseModel):
    base_model_id: str


@app.post("/load-base-model")
async def load_base_model_endpoint(req: LoadBaseModelRequest):
    if req.base_model_id not in BASE_MODEL_REGISTRY:
        raise HTTPException(400, f"Unknown base model: {req.base_model_id}")
    if is_base_loading():
        raise HTTPException(409, "A base model is already loading — please wait.")
    threading.Thread(target=load_base_model, args=(req.base_model_id,), daemon=True).start()
    return {"status": "loading", "base_model_id": req.base_model_id}


class LoadModelRequest(BaseModel):
    model_id: str


@app.post("/load-model")
async def load_model_endpoint(req: LoadModelRequest):
    if req.model_id not in MODEL_REGISTRY:
        raise HTTPException(400, f"Unknown model: {req.model_id}")
    if is_loading():
        raise HTTPException(409, "A model is already loading — please wait.")
    threading.Thread(target=load_model, args=(req.model_id,), daemon=True).start()
    return {"status": "loading", "model_id": req.model_id}


@app.get("/system/info")
async def system_info():
    gpu_name = None
    vram_total_gb = None
    vram_used_gb = None
    if torch.cuda.is_available():
        props = torch.cuda.get_device_properties(0)
        gpu_name = props.name
        vram_total_gb = round(props.total_memory / 1024 ** 3, 1)
        vram_used_gb = round(torch.cuda.memory_allocated(0) / 1024 ** 3, 2)

    return {
        "gpu": gpu_name,
        "vram_total_gb": vram_total_gb,
        "vram_used_gb": vram_used_gb,
        "current_model": current_model_id(),
        "loading": is_loading(),
        "ready": is_ready(),
        "base_ready": is_base_ready(),
        "base_loading": is_base_loading(),
        "base_model": get_base_model_id(),
    }


@app.post("/upload")
async def upload_media(file: UploadFile = File(...)):
    if not is_supported(file.filename or ""):
        raise HTTPException(400, "Unsupported format. Use MP4/AVI/MOV/MKV/WebM or JPG/PNG/WebP/BMP.")

    media_id = str(uuid.uuid4())
    suffix = Path(file.filename).suffix.lower()
    dest = UPLOAD_DIR / f"{media_id}{suffix}"
    dest.write_bytes(await file.read())

    if is_image(file.filename or ""):
        duration = 0.0
        media_type = "image"
    else:
        duration = get_duration(str(dest))
        media_type = "video"

    _video_store[media_id] = {
        "path": str(dest),
        "filename": file.filename,
        "duration": duration,
        "media_type": media_type,
    }

    return {"video_id": media_id, "filename": file.filename, "duration": duration, "media_type": media_type}


class ChatRequest(BaseModel):
    video_id: str
    prompt: str
    history: Optional[list[dict]] = None


@app.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    if not is_ready():
        raise HTTPException(503, "Model is still loading — try again in a moment.")

    if req.video_id not in _video_store:
        raise HTTPException(404, "Video not found. Upload a video first.")

    media = _video_store[req.video_id]
    model_cfg = MODEL_REGISTRY.get(current_model_id() or "", {})

    loop = asyncio.get_event_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def run():
        try:
            if media.get("media_type") == "image":
                frames = load_image(media["path"])
            else:
                fps = model_cfg.get("fps", 1.0)
                max_frames = model_cfg.get("max_frames", 8)
                frames = extract_frames(media["path"], fps=fps, max_frames=max_frames)
            for item in generate_stream_timed(frames, req.prompt, req.history or []):
                loop.call_soon_threadsafe(queue.put_nowait, item)
        except Exception as exc:
            loop.call_soon_threadsafe(queue.put_nowait, {"error": str(exc)})
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    threading.Thread(target=run, daemon=True).start()

    async def event_stream():
        while True:
            item = await queue.get()
            if item is None:
                yield "data: [DONE]\n\n"
                break
            if "error" in item:
                yield f"data: {json.dumps(item)}\n\n"
                break
            yield f"data: {json.dumps(item)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


class CompareRequest(BaseModel):
    video_id: str
    prompt: str


@app.post("/compare/stream")
async def compare_stream(req: CompareRequest):
    if not is_ready():
        raise HTTPException(503, "Active model not ready — try again in a moment.")
    if not is_base_ready():
        raise HTTPException(503, "Base model (Qwen2.5-VL-7B) is still loading — please wait.")
    if req.video_id not in _video_store:
        raise HTTPException(404, "Video not found. Upload a video first.")

    media = _video_store[req.video_id]
    model_cfg = MODEL_REGISTRY.get(current_model_id() or "", {})
    active_id = current_model_id()
    base_id = get_base_model_id()

    loop = asyncio.get_event_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def run():
        try:
            # Extract frames once — both models see identical input for a fair comparison.
            if media.get("media_type") == "image":
                frames = load_image(media["path"])
            else:
                fps = model_cfg.get("fps", 1.0)
                max_frames = model_cfg.get("max_frames", 8)
                frames = extract_frames(media["path"], fps=fps, max_frames=max_frames)

            # --- Active model ---
            loop.call_soon_threadsafe(queue.put_nowait, {"phase": "start_model", "model": active_id})
            active_response = ""
            for item in generate_stream_timed(frames, req.prompt, []):
                if item["type"] == "token":
                    active_response += item["token"]
                    loop.call_soon_threadsafe(queue.put_nowait,
                        {"phase": "token", "model": active_id, "token": item["token"]})
                else:
                    loop.call_soon_threadsafe(queue.put_nowait,
                        {"phase": "model_done", "model": active_id,
                         "metrics": {k: v for k, v in item.items() if k != "type"}})

            # --- Base model (same frames) ---
            loop.call_soon_threadsafe(queue.put_nowait, {"phase": "start_model", "model": base_id})
            base_response = ""
            for item in generate_base_stream_timed(frames, req.prompt, []):
                if item["type"] == "token":
                    base_response += item["token"]
                    loop.call_soon_threadsafe(queue.put_nowait,
                        {"phase": "token", "model": base_id, "token": item["token"]})
                else:
                    loop.call_soon_threadsafe(queue.put_nowait,
                        {"phase": "model_done", "model": base_id,
                         "metrics": {k: v for k, v in item.items() if k != "type"}})

            # --- ROUGE-L similarity ---
            from rouge_score import rouge_scorer as rs
            scorer = rs.RougeScorer(["rougeL"], use_stemmer=True)
            score = scorer.score(active_response, base_response)
            loop.call_soon_threadsafe(queue.put_nowait,
                {"phase": "compare_done", "rouge_l": round(score["rougeL"].fmeasure, 3)})

        except Exception as exc:
            loop.call_soon_threadsafe(queue.put_nowait, {"error": str(exc)})
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    threading.Thread(target=run, daemon=True).start()

    async def event_stream():
        while True:
            item = await queue.get()
            if item is None:
                yield "data: [DONE]\n\n"
                break
            yield f"data: {json.dumps(item)}\n\n"
            if "error" in item:
                break

    return StreamingResponse(event_stream(), media_type="text/event-stream")
