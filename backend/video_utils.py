from pathlib import Path
from decord import VideoReader, cpu
from PIL import Image


def extract_frames(video_path: str, fps: float = 1.0, max_frames: int = 8) -> list[Image.Image]:
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
    vr = VideoReader(video_path, ctx=cpu(0))
    return len(vr) / vr.get_avg_fps()


SUPPORTED_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}


def is_supported(filename: str) -> bool:
    return Path(filename).suffix.lower() in SUPPORTED_EXTENSIONS
