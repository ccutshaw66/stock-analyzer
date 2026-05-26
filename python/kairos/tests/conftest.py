"""Pytest config — ensures `kairos_trading` is importable from the repo layout."""
import sys
from pathlib import Path

# python/kairos/tests/conftest.py → python/kairos/
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
