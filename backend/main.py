import asyncio
import json
import threading
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from video_utils import extract_frames, get_duration, is_supported
from vlm import generate_stream, is_ready, load_model

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

_video_store: dict[str, dict] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    threading.Thread(target=load_model, daemon=True).start()
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


@app.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    if not is_supported(file.filename or ""):
        raise HTTPException(400, "Unsupported format. Use MP4, AVI, MOV, MKV, or WebM.")

    video_id = str(uuid.uuid4())
    suffix = Path(file.filename).suffix.lower()
    dest = UPLOAD_DIR / f"{video_id}{suffix}"

    dest.write_bytes(await file.read())

    duration = get_duration(str(dest))
    _video_store[video_id] = {
        "path": str(dest),
        "filename": file.filename,
        "duration": duration,
    }

    return {"video_id": video_id, "filename": file.filename, "duration": duration}


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

    video = _video_store[req.video_id]
    loop = asyncio.get_event_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def run():
        try:
            frames = extract_frames(video["path"])
            for token in generate_stream(frames, req.prompt, req.history or []):
                loop.call_soon_threadsafe(queue.put_nowait, token)
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
            if isinstance(item, dict):
                yield f"data: {json.dumps(item)}\n\n"
                break
            yield f"data: {json.dumps({'token': item})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
