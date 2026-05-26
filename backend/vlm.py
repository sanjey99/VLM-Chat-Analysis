import gc
import logging
import threading
import time
from abc import ABC, abstractmethod
from typing import Iterator

import torch
from PIL import Image
from transformers import AutoProcessor, TextIteratorStreamer

from config import MODEL_REGISTRY, MAX_NEW_TOKENS

logger = logging.getLogger(__name__)

_adapter = None
_current_model_id: str | None = None
_load_lock = threading.Lock()
_gen_lock = threading.Lock()
_loading = False

_base_adapter = None
_base_current_id: str | None = None
_base_load_lock = threading.Lock()
_base_loading = False


# ---------------------------------------------------------------------------
# Adapters
# ---------------------------------------------------------------------------

class BaseAdapter(ABC):
    def __init__(self, model_id: str, cfg: dict):
        self.model_id = model_id
        self.cfg = cfg
        self.processor = None
        self.model = None

    def _quantization_config(self):
        if not self.cfg["use_4bit"]:
            return None
        from transformers import BitsAndBytesConfig
        return BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_compute_dtype=torch.bfloat16,
        )

    @abstractmethod
    def load(self) -> None: ...

    @abstractmethod
    def generate_stream(
        self,
        frames: list[Image.Image],
        prompt: str,
        history: list[dict],
    ) -> Iterator[str]: ...

    def unload(self) -> None:
        del self.model
        del self.processor
        self.model = None
        self.processor = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


class QwenAdapter(BaseAdapter):
    def load(self) -> None:
        from transformers import AutoModelForImageTextToText

        logger.info("[%s] Loading processor…", self.model_id)
        self.processor = AutoProcessor.from_pretrained(
            self.model_id,
            max_pixels=self.cfg["max_pixels"],
        )
        logger.info("[%s] Loading model weights…", self.model_id)
        t0 = time.time()
        self.model = AutoModelForImageTextToText.from_pretrained(
            self.model_id,
            dtype=None if self.cfg["use_4bit"] else torch.bfloat16,
            quantization_config=self._quantization_config(),
            device_map="auto",
        )
        logger.info("[%s] Weights loaded in %.1fs, setting eval mode…", self.model_id, time.time() - t0)
        self.model.eval()
        logger.info("[%s] Ready.", self.model_id)

    def generate_stream(
        self,
        frames: list[Image.Image],
        prompt: str,
        history: list[dict],
    ) -> Iterator[str]:
        from qwen_vl_utils import process_vision_info

        messages = list(history)
        content = [{"type": "image", "image": frame} for frame in frames]
        content.append({"type": "text", "text": prompt})
        messages.append({"role": "user", "content": content})

        text = self.processor.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        image_inputs, video_inputs = process_vision_info(messages)
        inputs = self.processor(
            text=[text],
            images=image_inputs,
            videos=video_inputs,
            return_tensors="pt",
        ).to(self.model.device)

        streamer = TextIteratorStreamer(
            self.processor.tokenizer,
            skip_prompt=True,
            skip_special_tokens=True,
        )
        max_tokens = self.cfg.get("max_new_tokens", MAX_NEW_TOKENS)
        gen_kwargs = dict(**inputs, streamer=streamer, max_new_tokens=max_tokens)
        thread = threading.Thread(target=self.model.generate, kwargs=gen_kwargs, daemon=True)
        with _gen_lock:
            thread.start()
            yield from streamer
            thread.join()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

_FAMILY_MAP = {"qwen": QwenAdapter}


def _build_adapter(model_id: str, cfg: dict) -> BaseAdapter:
    cls = _FAMILY_MAP[cfg["family"]]
    return cls(model_id, cfg)


def load_model(model_id: str) -> None:
    global _adapter, _current_model_id, _loading

    with _load_lock:
        _loading = True
        try:
            if _adapter is not None:
                logger.info("Unloading %s…", _current_model_id)
                _adapter.unload()
                _adapter = None
                _current_model_id = None

            logger.info("Starting load: %s", model_id)
            cfg = MODEL_REGISTRY[model_id]
            new_adapter = _build_adapter(model_id, cfg)
            new_adapter.load()
            _adapter = new_adapter
            _current_model_id = model_id
            logger.info("Model ready: %s", model_id)
        except Exception:
            logger.exception("Failed to load model %s", model_id)
            raise
        finally:
            _loading = False


def load_base_model(model_id: str) -> None:
    global _base_adapter, _base_current_id, _base_loading
    from config import BASE_MODEL_REGISTRY

    with _base_load_lock:
        _base_loading = True
        try:
            if _base_adapter is not None:
                logger.info("Unloading base model %s…", _base_current_id)
                _base_adapter.unload()
                _base_adapter = None
                _base_current_id = None

            logger.info("Starting base model load: %s", model_id)
            cfg = BASE_MODEL_REGISTRY[model_id]
            new_adapter = _build_adapter(model_id, cfg)
            new_adapter.load()
            _base_adapter = new_adapter
            _base_current_id = model_id
            logger.info("Base model ready: %s", model_id)
        except Exception:
            logger.exception("Failed to load base model %s", model_id)
            raise
        finally:
            _base_loading = False


def is_ready() -> bool:
    return _adapter is not None and not _loading


def is_loading() -> bool:
    return _loading


def current_model_id() -> str | None:
    return _current_model_id


def is_base_ready() -> bool:
    return _base_adapter is not None and not _base_loading


def is_base_loading() -> bool:
    return _base_loading


def get_base_model_id() -> str | None:
    return _base_current_id


def generate_stream(
    frames: list[Image.Image],
    prompt: str,
    history: list[dict],
) -> Iterator[str]:
    return _adapter.generate_stream(frames, prompt, history)


def _stream_timed(
    adapter: BaseAdapter,
    frames: list[Image.Image],
    prompt: str,
    history: list[dict],
) -> Iterator[dict]:
    """Wraps an adapter's generate_stream, yielding token dicts then a final metrics dict."""
    start = time.time()
    ttft: float | None = None
    count = 0
    for token in adapter.generate_stream(frames, prompt, history):
        now = time.time()
        if ttft is None:
            ttft = (now - start) * 1000
        count += 1
        yield {"type": "token", "token": token}
    total_ms = (time.time() - start) * 1000
    gen_ms = max(total_ms - (ttft or 0), 0.001)
    vram_used_gb = None
    if torch.cuda.is_available():
        try:
            vram_used_gb = round(torch.cuda.memory_allocated(0) / 1024 ** 3, 2)
        except Exception:
            pass
    yield {
        "type": "metrics",
        "ttft_ms": round(ttft or 0),
        "total_ms": round(total_ms),
        "tokens_per_sec": round(count / (gen_ms / 1000), 1),
        "token_count": count,
        "vram_used_gb": vram_used_gb,
    }


def generate_stream_timed(
    frames: list[Image.Image],
    prompt: str,
    history: list[dict],
) -> Iterator[dict]:
    return _stream_timed(_adapter, frames, prompt, history)


def generate_base_stream_timed(
    frames: list[Image.Image],
    prompt: str,
    history: list[dict],
) -> Iterator[dict]:
    return _stream_timed(_base_adapter, frames, prompt, history)
