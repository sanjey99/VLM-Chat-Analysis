import gc
import logging
import threading
import time
from abc import ABC, abstractmethod
from typing import Callable, Iterator

import torch
from PIL import Image
from transformers import AutoProcessor, TextIteratorStreamer

from config import MODEL_REGISTRY, BASE_MODEL_REGISTRY, DEFAULT_BASE_MODEL, MAX_NEW_TOKENS

logger = logging.getLogger(__name__)

_adapter = None
_current_model_id: str | None = None
_load_lock = threading.Lock()
_gen_lock = threading.Lock()
_loading = False

# Selected base model for compare — loaded on demand, not pre-loaded.
_selected_base_id: str | None = DEFAULT_BASE_MODEL


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


def is_ready() -> bool:
    return _adapter is not None and not _loading


def is_loading() -> bool:
    return _loading


def current_model_id() -> str | None:
    return _current_model_id


def set_base_model_id(model_id: str) -> None:
    global _selected_base_id
    _selected_base_id = model_id


def get_base_model_id() -> str | None:
    return _selected_base_id


def is_base_ready() -> bool:
    """Always True — base model is selected at startup and loaded on demand during compare."""
    return _selected_base_id is not None


def is_base_loading() -> bool:
    return False


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


def run_compare_consecutive(
    frames: list[Image.Image],
    prompt: str,
    active_history: list[dict],
    base_history: list[dict],
    on_event: Callable[[dict], None],
) -> None:
    """
    Runs active model, unloads it, loads base model (full precision), runs base,
    unloads base, then reloads active in background. Only one model in VRAM at a time.
    Each model receives its own prior turn history so multi-turn compare works correctly.
    """
    global _adapter, _current_model_id, _loading

    active_id: str | None = None

    # Claim exclusive access: set _loading=True to block concurrent chat/compare requests.
    with _load_lock:
        if not (_adapter is not None and not _loading):
            raise RuntimeError("Active model not ready")
        if not _selected_base_id:
            raise RuntimeError("No base model selected")
        active_id = _current_model_id
        base_id = _selected_base_id
        _loading = True

    active_response = ""
    base_response = ""
    base_adapter = None

    try:
        # --- Active model ---
        on_event({"phase": "start_model", "model": active_id})
        for item in _stream_timed(_adapter, frames, prompt, active_history):
            if item["type"] == "token":
                active_response += item["token"]
                on_event({"phase": "token", "model": active_id, "token": item["token"]})
            else:
                on_event({"phase": "model_done", "model": active_id,
                         "metrics": {k: v for k, v in item.items() if k != "type"}})

        # --- Unload active ---
        _adapter.unload()
        _adapter = None
        _current_model_id = None

        # --- Load base ---
        on_event({"phase": "loading_base", "model": base_id})
        base_cfg = BASE_MODEL_REGISTRY[base_id]
        base_adapter = _build_adapter(base_id, base_cfg)
        base_adapter.load()

        # --- Run base ---
        on_event({"phase": "start_model", "model": base_id})
        for item in _stream_timed(base_adapter, frames, prompt, base_history):
            if item["type"] == "token":
                base_response += item["token"]
                on_event({"phase": "token", "model": base_id, "token": item["token"]})
            else:
                on_event({"phase": "model_done", "model": base_id,
                         "metrics": {k: v for k, v in item.items() if k != "type"}})

        # --- Unload base ---
        base_adapter.unload()
        base_adapter = None

        # --- ROUGE-L ---
        from rouge_score import rouge_scorer as rs
        scorer = rs.RougeScorer(["rougeL"], use_stemmer=True)
        score = scorer.score(active_response, base_response)
        on_event({"phase": "compare_done", "rouge_l": round(score["rougeL"].fmeasure, 3)})

    except Exception as exc:
        on_event({"error": str(exc)})
        if base_adapter is not None:
            try:
                base_adapter.unload()
            except Exception:
                pass

    finally:
        with _load_lock:
            _loading = False

    # Reload active model in background so the user can continue chatting.
    if active_id:
        threading.Thread(target=load_model, args=(active_id,), daemon=True).start()


def run_eval_consecutive(
    cases: list[dict],
    model_ids: list[str],
    on_event: Callable[[dict], None],
) -> None:
    """
    Evaluates a set of (video, prompt, reference?) cases across multiple models.
    Loads each model in full precision, runs all cases, then unloads before the next model.
    Emits SSE-style event dicts via on_event. Reloads the original active model on completion.

    cases: [{path, media_type, prompt, reference?}]
    model_ids: list of IDs from MODEL_REGISTRY or BASE_MODEL_REGISTRY
    """
    global _adapter, _current_model_id, _loading

    from video_utils import extract_frames, load_image

    all_registry = {**MODEL_REGISTRY, **BASE_MODEL_REGISTRY}
    original_model_id: str | None = None

    with _load_lock:
        if _loading:
            raise RuntimeError("Another operation is in progress — wait for the current task to finish.")
        if not model_ids:
            raise RuntimeError("No models selected.")
        original_model_id = _current_model_id
        _loading = True

    # Accumulated results: all_results[model_id][case_idx]
    all_results: dict[str, list[dict]] = {}
    # Frame cache so the same video isn't decoded repeatedly for each model
    frame_cache: dict[tuple, list] = {}

    try:
        if _adapter is not None:
            _adapter.unload()
            _adapter = None
            _current_model_id = None

        for m_idx, model_id in enumerate(model_ids):
            if model_id not in all_registry:
                on_event({"error": f"Unknown model: {model_id}"})
                continue

            on_event({"phase": "loading_model", "model": model_id,
                      "model_idx": m_idx, "total_models": len(model_ids)})

            cfg = all_registry[model_id]
            _adapter = _build_adapter(model_id, cfg)
            _adapter.load()
            _current_model_id = model_id

            fps = cfg.get("fps", 1.0)
            max_frames = cfg.get("max_frames", 8)
            model_cases: list[dict] = []

            for c_idx, case in enumerate(cases):
                on_event({"phase": "start_case", "model": model_id,
                          "case_idx": c_idx, "total_cases": len(cases)})

                cache_key = (case["path"], case["media_type"], fps, max_frames)
                if cache_key not in frame_cache:
                    if case["media_type"] == "image":
                        frame_cache[cache_key] = load_image(case["path"])
                    else:
                        frame_cache[cache_key] = extract_frames(
                            case["path"], fps=fps, max_frames=max_frames)
                frames = frame_cache[cache_key]

                response = ""
                metrics_dict: dict | None = None
                for item in _stream_timed(_adapter, frames, case["prompt"], []):
                    if item["type"] == "token":
                        response += item["token"]
                        on_event({"phase": "token", "model": model_id,
                                  "case_idx": c_idx, "token": item["token"]})
                    else:
                        metrics_dict = {k: v for k, v in item.items() if k != "type"}

                rouge_l: float | None = None
                if case.get("reference") and response:
                    from rouge_score import rouge_scorer as rs
                    scorer = rs.RougeScorer(["rougeL"], use_stemmer=True)
                    score = scorer.score(case["reference"], response)
                    rouge_l = round(score["rougeL"].fmeasure, 3)

                case_result = {"response": response, "metrics": metrics_dict, "rouge_l": rouge_l}
                model_cases.append(case_result)
                on_event({"phase": "case_done", "model": model_id,
                          "case_idx": c_idx, "result": case_result})

            all_results[model_id] = model_cases
            _adapter.unload()
            _adapter = None
            _current_model_id = None
            on_event({"phase": "model_done", "model": model_id})

        # --- BERTScore (optional — graceful if package absent) ---
        try:
            from bert_score import score as bert_score_fn  # type: ignore
            refs_flat: list[str] = []
            hyps_flat: list[str] = []
            ref_keys: list[tuple[str, int]] = []

            for model_id in model_ids:
                for c_idx, (case, result) in enumerate(
                        zip(cases, all_results.get(model_id, []))):
                    if case.get("reference") and result.get("response"):
                        refs_flat.append(case["reference"])
                        hyps_flat.append(result["response"])
                        ref_keys.append((model_id, c_idx))

            if refs_flat:
                on_event({"phase": "computing_bert_score"})
                _, _, F1 = bert_score_fn(
                    hyps_flat, refs_flat, lang="en", verbose=False, device="cpu")
                for (model_id, c_idx), f1 in zip(ref_keys, F1.tolist()):
                    all_results[model_id][c_idx]["bert_score"] = round(f1, 3)
        except ImportError:
            pass

        # --- Leaderboard ---
        leaderboard = []
        for model_id in model_ids:
            case_results = all_results.get(model_id, [])
            if not case_results:
                continue
            ttfts = [r["metrics"]["ttft_ms"] for r in case_results if r.get("metrics")]
            tokpss = [r["metrics"]["tokens_per_sec"] for r in case_results if r.get("metrics")]
            rouge_ls = [r["rouge_l"] for r in case_results if r.get("rouge_l") is not None]
            bert_scores = [r.get("bert_score") for r in case_results
                           if r.get("bert_score") is not None]
            leaderboard.append({
                "model_id": model_id,
                "label": all_registry[model_id]["label"],
                "avg_ttft_ms": round(sum(ttfts) / len(ttfts)) if ttfts else None,
                "avg_tokens_per_sec": round(sum(tokpss) / len(tokpss), 1) if tokpss else None,
                "avg_rouge_l": round(sum(rouge_ls) / len(rouge_ls), 3) if rouge_ls else None,
                "avg_bert_score": round(sum(bert_scores) / len(bert_scores), 3)
                                  if bert_scores else None,
            })
        leaderboard.sort(
            key=lambda x: x["avg_rouge_l"] or x["avg_tokens_per_sec"] or 0, reverse=True)

        details = [
            {
                "case_idx": i,
                "prompt": cases[i]["prompt"],
                "reference": cases[i].get("reference"),
                "results": {
                    mid: all_results[mid][i]
                    for mid in model_ids
                    if mid in all_results and i < len(all_results[mid])
                },
            }
            for i in range(len(cases))
        ]
        on_event({"phase": "eval_done", "leaderboard": leaderboard, "details": details})

    except Exception as exc:
        on_event({"error": str(exc)})
        if _adapter is not None:
            try:
                _adapter.unload()
            except Exception:
                pass
            _adapter = None
            _current_model_id = None

    finally:
        with _load_lock:
            _loading = False

    if original_model_id:
        threading.Thread(target=load_model, args=(original_model_id,), daemon=True).start()
