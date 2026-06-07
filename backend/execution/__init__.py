"""Execution: pyautogui actions + the see-and-act run loop.

Every input action must remain interruptible (corner failsafe now; panic stop in M3).
"""

from platform_dpi import enable_dpi_awareness

enable_dpi_awareness()
