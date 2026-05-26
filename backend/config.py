MODEL_REGISTRY: dict[str, dict] = {
    "nvidia/Cosmos-Reason2-2B": {
        "label": "Cosmos-Reason2 2B — NVIDIA",
        "family": "qwen",
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
        "use_4bit": False,
        "max_pixels": 1280 * 28 * 28,
        "fps": 1.5,
        "max_frames": 16,
        "max_new_tokens": 1024,
    },
    "nvidia/Cosmos-Reason2-8B": {
        "label": "Cosmos-Reason2 8B — NVIDIA",
        "family": "qwen",
        "use_4bit": False,
        "max_pixels": 1280 * 28 * 28,
        "fps": 1.0,
        "max_frames": 8,
        "max_new_tokens": 4096,  # reasoning model — long thinking traces
        # Gated — accept license + set HF_TOKEN: https://hf.co/nvidia/Cosmos-Reason2-8B
    },
}

DEFAULT_MODEL = "Darwin-Project/MUSEG-3B"

# Global fallback — per-model max_new_tokens takes precedence
MAX_NEW_TOKENS = 512
