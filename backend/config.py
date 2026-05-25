MODEL_REGISTRY: dict[str, dict] = {
    "Qwen/Qwen3-VL-2B-Instruct": {
        "label": "Qwen3-VL 2B — Fastest",
        "family": "qwen",
        "use_4bit": False,
        "max_pixels": 1280 * 28 * 28,
        "fps": 1.0,
        "max_frames": 8,
    },
    "Qwen/Qwen3-VL-4B-Instruct": {
        "label": "Qwen3-VL 4B — Balanced",
        "family": "qwen",
        "use_4bit": False,
        "max_pixels": 1280 * 28 * 28,
        "fps": 1.0,
        "max_frames": 8,
    },
    "Qwen/Qwen3-VL-8B-Instruct": {
        "label": "Qwen3-VL 8B — Quality",
        "family": "qwen",
        "use_4bit": False,
        "max_pixels": 1280 * 28 * 28,
        "fps": 1.0,
        "max_frames": 8,
    },
    "google/gemma-4-E4B-it": {
        "label": "Gemma 4 E4B — Google Alt",
        "family": "gemma",
        "use_4bit": False,
        "max_pixels": 896 * 896,
        "fps": 1.0,
        "max_frames": 8,
    },
}

DEFAULT_MODEL = "Qwen/Qwen3-VL-2B-Instruct"

# Fallback generation cap (per-model fps/max_frames take precedence)
MAX_NEW_TOKENS = 512
