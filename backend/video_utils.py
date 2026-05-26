from pathlib import Path
from PIL import Image


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tiff"}
VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}
SUPPORTED_EXTENSIONS = VIDEO_EXTENSIONS | IMAGE_EXTENSIONS


def is_image(filename: str) -> bool:
    return Path(filename).suffix.lower() in IMAGE_EXTENSIONS


def is_supported(filename: str) -> bool:
    return Path(filename).suffix.lower() in SUPPORTED_EXTENSIONS


def load_image(path: str) -> list[Image.Image]:
    return [Image.open(path).convert("RGB")]


def extract_frames(video_path: str, fps: float = 1.0, max_frames: int = 8) -> list[Image.Image]:
    from decord import VideoReader, cpu

    vr = VideoReader(video_path, ctx=cpu(0))
    total_frames = len(vr)
    video_fps = vr.get_avg_fps()

    frame_interval = max(1, int(video_fps / fps))
    indices = list(range(0, total_frames, frame_interval))

    if len(indices) > max_frames:
        step = len(indices) / max_frames
        indices = [indices[int(i * step)] for i in range(max_frames)]

    raw = vr.get_batch(indices).asnumpy()
    return [Image.fromarray(frame) for frame in raw]


def get_duration(video_path: str) -> float:
    from decord import VideoReader, cpu

    vr = VideoReader(video_path, ctx=cpu(0))
    return len(vr) / vr.get_avg_fps()
