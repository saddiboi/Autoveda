"""Perception adapters (accessibility / OCR / vision / window enumeration).

Kept behind small functions so methods stay swappable per CLAUDE.md.
"""

# Establish DPI awareness before any capture / accessibility call so coordinates
# are consistent physical pixels.
from platform_dpi import enable_dpi_awareness

enable_dpi_awareness()
