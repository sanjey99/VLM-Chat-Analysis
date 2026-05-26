MODEL_REGISTRY: dict[str, dict] = {
    "nvidia/Cosmos-Reason2-2B": {
        "label": "Cosmos-Reason2 2B — NVIDIA",
        "family": "qwen",
        "input_type": "image",
        "use_4bit": False,
        "max_pixels": 1280 * 28 * 28,
        "fps": 1.0,
        "max_frames": 8,
        "max_new_tokens": 4096,  # reasoning model — long thinking traces
        # Gated — accept license + set HF_TOKEN: https://hf.co/nvidia/Cosmos-Reason2-2B
    },
    "Darwin-Project/MUSEG-3B": {
        "label": "MUSEG 3B — Video Specialist",
        "family": "qwen",
        "input_type": "video",
        "use_4bit": False,
        "max_pixels": 1280 * 28 * 28,
        "fps": 1.5,
        "max_frames": 16,
        "max_new_tokens": 1024,
    },
    "nvidia/Cosmos-Reason2-8B": {
        "label": "Cosmos-Reason2 8B — NVIDIA",
        "family": "qwen",
        "input_type": "image",
        "use_4bit": False,
        "max_pixels": 1280 * 28 * 28,
        "fps": 1.0,
        "max_frames": 8,
        "max_new_tokens": 4096,  # reasoning model — long thinking traces
        # Gated — accept license + set HF_TOKEN: https://hf.co/nvidia/Cosmos-Reason2-8B
    },
}

DEFAULT_MODEL = "Darwin-Project/MUSEG-3B"

# Base models available for compare mode.
BASE_MODEL_REGISTRY: dict[str, dict] = {
    "Qwen/Qwen2.5-VL-2B-Instruct": {
        "label": "Qwen2.5-VL 2B",
        "family": "qwen",
        "input_type": "both",
        "use_4bit": False,
        "max_pixels": 1280 * 28 * 28,
        "fps": 1.0,
        "max_frames": 8,
        "max_new_tokens": 1024,
    },
    "Qwen/Qwen2.5-VL-3B-Instruct": {
        "label": "Qwen2.5-VL 3B",
        "family": "qwen",
        "input_type": "both",
        "use_4bit": False,
        "max_pixels": 1280 * 28 * 28,
        "fps": 1.0,
        "max_frames": 8,
        "max_new_tokens": 1024,
    },
    "Qwen/Qwen2.5-VL-7B-Instruct": {
        "label": "Qwen2.5-VL 7B",
        "family": "qwen",
        "input_type": "both",
        "use_4bit": True,
        "max_pixels": 1280 * 28 * 28,
        "fps": 1.0,
        "max_frames": 8,
        "max_new_tokens": 1024,
    },
}

DEFAULT_BASE_MODEL = "Qwen/Qwen2.5-VL-7B-Instruct"

# Global fallback — per-model max_new_tokens takes precedence
MAX_NEW_TOKENS = 512
