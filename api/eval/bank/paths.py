"""Fixed locations of the case bank files."""

from pathlib import Path
from typing import Final

EVAL_DIR: Final = Path(__file__).resolve().parent.parent  # api/eval
API_DIR: Final = EVAL_DIR.parent
CASES_DIR: Final = EVAL_DIR / "cases"
MATERIALS_DIR: Final = EVAL_DIR / "materials"
RESULTS_DIR: Final = EVAL_DIR / "results"
PROFILES_FILE: Final = EVAL_DIR / "profiles.json"
SAVED_RUNS_FILE: Final = EVAL_DIR / "saved_runs.json"
