"""Layered locator: accessibility tree first, then Tesseract OCR (per CLAUDE.md).

Stops at the first success and reports which method resolved the target. Any
adapter failure degrades to the next layer rather than aborting the whole step.
"""

from __future__ import annotations

import logging
from typing import Optional

from .accessibility import AccessibilityUnavailable, find_element
from .ocr import OCRUnavailable, find_text

log = logging.getLogger("autoveda.locate")


def locate(target, image, origin, region=None, window_id=None):
    """Return (match_dict | None, error | None). match_dict carries `method`."""
    # 1) Accessibility tree
    try:
        res = find_element(target, region=region, window_id=window_id)
        if res:
            log.info("accessibility matched %r -> %s", target, res["bbox"])
            return res, None
        log.info("accessibility: no match for %r, trying OCR", target)
    except AccessibilityUnavailable as exc:
        log.info("accessibility unavailable: %s", exc)
    except Exception as exc:  # never let a UIA hiccup kill the step
        log.warning("accessibility error: %s", exc)

    # 2) Tesseract OCR
    try:
        res = find_text(image, target, origin=origin)
        if res:
            log.info("ocr matched %r -> %s", target, res["bbox"])
            return res, None
        return None, f"'{target}' not found via accessibility or OCR"
    except OCRUnavailable as exc:
        return None, f"accessibility found nothing and OCR unavailable: {exc}"
    except Exception as exc:
        return None, f"OCR error: {exc}"
