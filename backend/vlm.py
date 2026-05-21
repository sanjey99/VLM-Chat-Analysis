import threading
from typing import Iterator
import torch
from transformers import Qwen2_5_VLForConditionalGeneration, AutoProcessor, TextIteratorStreamer
from qwen_vl_utils import process_vision_info
from PIL import Image
from config import MODEL_ID, USE_4BIT, MAX_PIXELS, MAX_NEW_TOKENS

_model = None
_processor = None
_lock = threading.Lock()


def load_model() -> None:
    global _model, _processor

    quantization_config = None
    if USE_4BIT:
        from transformers import BitsAndBytesConfig
        quantization_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_compute_dtype=torch.bfloat16,
        )

    _processor = AutoProcessor.from_pretrained(
        MODEL_ID,
        max_pixels=MAX_PIXELS,
    )
    _model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
        MODEL_ID,
        torch_dtype=None if USE_4BIT else torch.bfloat16,
        quantization_config=quantization_config,
        device_map="auto",
    )
    _model.eval()


def is_ready() -> bool:
    return _model is not None


def generate_stream(
    frames: list[Image.Image],
    prompt: str,
    history: list[dict],
) -> Iterator[str]:
    messages = list(history)

    content = [{"type": "image", "image": frame} for frame in frames]
    content.append({"type": "text", "text": prompt})
    messages.append({"role": "user", "content": content})

    text = _processor.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
    )
    image_inputs, video_inputs = process_vision_info(messages)
    inputs = _processor(
        text=[text],
        images=image_inputs,
        videos=video_inputs,
        return_tensors="pt",
    ).to(_model.device)

    streamer = TextIteratorStreamer(
        _processor.tokenizer,
        skip_prompt=True,
        skip_special_tokens=True,
    )

    gen_kwargs = dict(**inputs, streamer=streamer, max_new_tokens=MAX_NEW_TOKENS)

    thread = threading.Thread(target=_model.generate, kwargs=gen_kwargs, daemon=True)
    with _lock:
        thread.start()
        for token in streamer:
            yield token
        thread.join()
