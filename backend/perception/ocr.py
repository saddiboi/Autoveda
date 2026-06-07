"""Tesseract OCR fallback: locate target text in a captured region image.

Requires the Tesseract binary at OS level (set TESSERACT_CMD or install to the
default path). Degrades to a clear OCRUnavailable error if it's missing, so the
layered locator can report it instead of crashing.

The word-matching logic is split into pure functions so it can be tested without
the Tesseract binary present.
"""

from __future__ import annotations

import os
import re
from typing import Optional

_DEFAULT_WIN_PATH = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
_configured = False


class OCRUnavailable(RuntimeError):
    """Tesseract binary not available / failed to run."""


def _configure() -> None:
    global _configured
    if _configured:
        return
    import pytesseract

    cmd = os.environ.get("TESSERACT_CMD")
    if not cmd and os.path.exists(_DEFAULT_WIN_PATH):
        cmd = _DEFAULT_WIN_PATH
    if cmd:
        pytesseract.pytesseract.tesseract_cmd = cmd
    _configured = True


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def match_words(words: list[dict], target: str) -> Optional[dict]:
    """Find `target` among OCR words. Prefers an exact consecutive-word match on a
    single line; falls back to a single-word substring. `words` items have keys
    text, conf, left, top, width, height, line. Returns region-local bbox or None.
    """
    target_norm = _norm(target)
    if not target_norm:
        return None
    tokens = target_norm.split()
    best = None

    for i in range(len(words)):
        seq = []
        j = i
        matched = True
        for tok in tokens:
            if j >= len(words) or words[j]["line"] != words[i]["line"]:
                matched = False
                break
            if tok not in _norm(words[j]["text"]):
                matched = False
                break
            seq.append(words[j])
            j += 1
        if matched and seq:
            left = min(w["left"] for w in seq)
            top = min(w["top"] for w in seq)
            right = max(w["left"] + w["width"] for w in seq)
            bottom = max(w["top"] + w["height"] for w in seq)
            joined = " ".join(w["text"] for w in seq)
            conf = sum(w["conf"] for w in seq) / len(seq)
            exact = _norm(joined) == target_norm
            cand = {"bbox": [left, top, right, bottom], "conf": conf, "text": joined, "exact": exact}
            key = (cand["exact"], cand["conf"])
            if best is None or key > (best["exact"], best["conf"]):
                best = cand

    if best is None:
        for w in words:  # single-word substring fallback
            if target_norm in _norm(w["text"]):
                cand = {
                    "bbox": [w["left"], w["top"], w["left"] + w["width"], w["top"] + w["height"]],
                    "conf": w["conf"],
                    "text": w["text"],
                    "exact": False,
                }
                if best is None or cand["conf"] > best["conf"]:
                    best = cand
    return best


def _extract_words(image, min_conf: float) -> list[dict]:
    import pytesseract
    from pytesseract import Output

    try:
        data = pytesseract.image_to_data(image, output_type=Output.DICT)
    except Exception as exc:  # binary missing / failed
        raise OCRUnavailable(
            "Tesseract is not available. Install it and/or set TESSERACT_CMD. "
            f"Underlying error: {exc}"
        ) from exc

    words = []
    for i in range(len(data["text"])):
        txt = (data["text"][i] or "").strip()
        if not txt:
            continue
        try:
            conf = float(data["conf"][i])
        except (TypeError, ValueError):
            conf = -1.0
        if conf < min_conf:
            continue
        words.append(
            {
                "text": txt,
                "conf": conf,
                "left": int(data["left"][i]),
                "top": int(data["top"][i]),
                "width": int(data["width"][i]),
                "height": int(data["height"][i]),
                "line": (data["block_num"][i], data["par_num"][i], data["line_num"][i]),
            }
        )
    return words


def find_text(image, target: str, origin=(0, 0), min_conf: float = 40.0) -> Optional[dict]:
    """OCR `image`, locate `target`, return an absolute-pixel match dict or None."""
    _configure()
    words = _extract_words(image, min_conf)
    best = match_words(words, target)
    if best is None:
        return None
    left, top, right, bottom = best["bbox"]
    ox, oy = origin
    abs_bbox = [left + ox, top + oy, right + ox, bottom + oy]
    cx = (abs_bbox[0] + abs_bbox[2]) // 2
    cy = (abs_bbox[1] + abs_bbox[3]) // 2
    return {
        "method": "ocr",
        "text": best["text"],
        "bbox": abs_bbox,
        "center": [cx, cy],
        "confidence": round(best["conf"] / 100.0, 3),
        "exact": best["exact"],
    }
