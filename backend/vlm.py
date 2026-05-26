import gc
import threading
from abc import ABC, abstractmethod
from typing import Iterator

import torch
from PIL import Image
from transformers import AutoProcessor, TextIteratorStreamer

from config import MODEL_REGISTRY, MAX_NEW_TOKENS

_adapter = None
_current_model_id: str | None = None
_load_lock = threading.Lock()
_gen_lock = threading.Lock()
_loading = False


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

        # Qwen3-VL uses the same class as Qwen2.5-VL in current transformers
        self.processor = AutoProcessor.from_pretrained(
            self.model_id,
            max_pixels=self.cfg["max_pixels"],
        )
        self.model = AutoModelForImageTextToText.from_pretrained(
            self.model_id,
            dtype=None if self.cfg["use_4bit"] else torch.bfloat16,
            quantization_config=self._quantization_config(),
            device_map="auto",
        )
        self.model.eval()

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


def _build_adapter(model_id: str) -> BaseAdapter:
    cfg = MODEL_REGISTRY[model_id]
    cls = _FAMILY_MAP[cfg["family"]]
    return cls(model_id, cfg)


def load_model(model_id: str) -> None:
    global _adapter, _current_model_id, _loading

    with _load_lock:
        _loading = True
        try:
            if _adapter is not None:
                _adapter.unload()
                _adapter = None
                _current_model_id = None

            new_adapter = _build_adapter(model_id)
            new_adapter.load()
            _adapter = new_adapter
            _current_model_id = model_id
        finally:
            _loading = False


def is_ready() -> bool:
    return _adapter is not None and not _loading


def is_loading() -> bool:
    return _loading


def current_model_id() -> str | None:
    return _current_model_id


def generate_stream(
    frames: list[Image.Image],
    prompt: str,
    history: list[dict],
) -> Iterator[str]:
    return _adapter.generate_stream(frames, prompt, history)
