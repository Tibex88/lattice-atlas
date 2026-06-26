import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
VENV_PYTHON = ROOT / ".venv" / "bin" / "python"


def _ensure_repo_venv():
    if not VENV_PYTHON.exists():
        return
    current = Path(sys.executable).resolve()
    target = VENV_PYTHON.resolve()
    if current == target:
        return
    os.execv(str(target), [str(target), str(ROOT / "app.py"), *sys.argv[1:]])


def main():
    _ensure_repo_venv()
    from dashboard.http import main as http_main

    http_main()


if __name__ == "__main__":
    main()
