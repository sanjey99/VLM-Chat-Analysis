MODEL_ID = "Qwen/Qwen2.5-VL-7B-Instruct"

# Set True to load in 4-bit (needs bitsandbytes) — cuts VRAM from ~15 GB to ~5 GB
USE_4BIT = False

# Frames per second to sample from video; capped by MAX_FRAMES
FPS = 1.0
MAX_FRAMES = 16

# Per-image resolution cap — reduce to 720*28*28 to save VRAM
MAX_PIXELS = 1280 * 28 * 28

# Generation limit
MAX_NEW_TOKENS = 512
