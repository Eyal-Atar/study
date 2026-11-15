"""Smoke test of PDF text extraction on real files: numbers only, never their text.

Usage, from api/:  uv run python eval/pdf_smoke.py eval/materials

For every PDF under the folder (recursively) it prints the file's basename, its page count,
scanned pages, extracted characters, warnings and the time taken, then one summary line.
It uses the default Settings and does not read api/.env.
"""

import argparse
import sys
import time
from pathlib import Path

# Running a file puts its own folder on sys.path, not api/; add api/ so that `app` imports.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import Settings
from app.jobs.pdf_text import PdfUnreadable, extract_pdf


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("folder", type=Path)
    folder: Path = parser.parse_args().folder
    settings = Settings(supabase_url="https://x.supabase.co", _env_file=None)

    files = sorted(
        (path for path in folder.rglob("*") if path.is_file() and path.suffix.lower() == ".pdf"),
        key=lambda path: str(path),
    )
    print(f"{'file':<50} {'pages':>5} {'scanned':>7} {'chars':>8} {'seconds':>7}  warnings")
    read = unreadable = fully_scanned = 0
    page_counts: list[int] = []
    started = time.perf_counter()
    for path in files:
        name = path.name[:50]
        file_started = time.perf_counter()
        try:
            extracted = extract_pdf(
                path.read_bytes(),
                max_pages=settings.max_material_pages,
                scanned_max_chars=settings.scanned_page_max_chars,
                max_chars_per_page=settings.max_chars_per_page,
            )
        except PdfUnreadable:
            unreadable += 1
            seconds = time.perf_counter() - file_started
            print(f"{name:<50} {'-':>5} {'-':>7} {'-':>8} {seconds:>7.2f}  unreadable")
            continue
        seconds = time.perf_counter() - file_started
        read += 1
        page_counts.append(extracted.page_count)
        if extracted.pages and extracted.scanned_pages == len(extracted.pages):
            fully_scanned += 1
        chars = sum(len(page.text) for page in extracted.pages)
        warnings = ",".join(extracted.warnings) or "-"
        print(
            f"{name:<50} {extracted.page_count:>5} {extracted.scanned_pages:>7} "
            f"{chars:>8} {seconds:>7.2f}  {warnings}"
        )
    total = time.perf_counter() - started
    pages = f"{min(page_counts)}-{max(page_counts)}" if page_counts else "-"
    print(
        f"summary: files={len(files)} read={read} unreadable={unreadable} "
        f"fully_scanned={fully_scanned} pages={pages} seconds={total:.2f}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
