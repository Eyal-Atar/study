"""Timetable parsing eval: the job's own parse (prompt, schema, validation) on timetable files.

Usage, from api/:
    uv run python eval/timetable_eval.py --render                     # samples -> PNG
    uv run python eval/timetable_eval.py [--models a,b] [--files x,y]   # estimate only
    uv run python eval/timetable_eval.py --run --max-usd 0.3 [--models a,b] [--effort low]

The files are every PNG, JPEG or PDF in eval/materials/timetables/ (git-ignored) that has an
expected answer: `<name>.expected.json` next to it, or in eval/timetable_samples/ for the
rendered samples. `--render` draws each sample (timetable_samples/<name>.html, checked in)
to materials/timetables/<name>.png with headless Chrome, and a rough stand-in for a phone
photo of it, <name>_photo.jpg (900 px wide, rotated 2 degrees, JPEG quality 45, with sips).

Without --run it makes no network call and needs no key: it prints, per file, the image
size, the estimated input and output tokens and the cost per model. With --run it needs
ANTHROPIC_API_KEY in api/.env, sends each file through `run_timetable` (the same code as the
parse_timetable job, up to two calls), stops before a call whose estimate (x2.2, for the
retry) would pass --max-usd, and scores each answer against the expected items:
- an item matches on weekday + start + end; precision and recall count matches;
- kind and title are scored on the matched items; a title is right when every word of the
  expected title (punctuation and spaces dropped) is contained in the answer's title.
A file whose expected answer says "readable": false is right when the parse fails as
timetable_unreadable ("right" counts files with the right outcome). Results go to
materials/timetables/results-<UTC date>.json (git-ignored).
"""

import argparse
import datetime as dt
import json
import math
import re
import struct
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

API_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API_DIR))

from app.ai.client import AnthropicAnalysisClient, Usage  # noqa: E402
from app.ai.timetable import (  # noqa: E402
    SYSTEM_PROMPT,
    USER_TEXT,
    TimetableFailed,
    TimetableItem,
    run_timetable,
)
from app.config import Settings  # noqa: E402
from app.domain.materials import IMAGE_MIMES, PDF_MIME, sniff_mime  # noqa: E402
from app.jobs.pdf_text import extract_pdf  # noqa: E402

EVAL_DIR = Path(__file__).resolve().parent
SAMPLES_DIR = EVAL_DIR / "timetable_samples"
FILES_DIR = EVAL_DIR / "materials" / "timetables"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SIPS = "/usr/bin/sips"
PHOTO_SUFFIX = "_photo"
DEFAULT_MODELS = ("claude-haiku-5-5", "claude-sonnet-5-5")
SUFFIX_MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".pdf": PDF_MIME}
# The API scales an image down to a long edge of 1568 px and about 1.15 megapixels; one
# token per 750 pixels after that. A PDF page costs its image plus its text.
MAX_EDGE = 1568
MAX_PIXELS = 1_150_000
PDF_PAGE_TOKENS = 2500
PROMPT_TOKENS = round((len(SYSTEM_PROMPT) + len(USER_TEXT)) / 3) + 400  # + the schema
OUTPUT_TOKENS = 3000  # thinking, at low effort, and about 40 tokens per item
SAFETY = 2.2


@dataclass
class Case:
    name: str
    path: Path
    mime: str
    data: bytes
    expected: list[dict[str, Any]]
    readable: bool
    input_tokens: int
    detail: str

    def estimate_usd(self, price: dict[str, float]) -> float:
        return cost_usd(price, self.input_tokens, OUTPUT_TOKENS)


def cost_usd(price: dict[str, float], input_tokens: float, output_tokens: float) -> float:
    return (input_tokens * price["input"] + output_tokens * price["output"]) / 1_000_000


def usage_usd(price: dict[str, float], usage: Usage) -> float:
    input_equivalent = (
        usage.input_tokens
        + 1.25 * usage.cache_creation_input_tokens
        + 0.1 * usage.cache_read_input_tokens
    )
    return cost_usd(price, input_equivalent, usage.output_tokens)


def image_size(data: bytes, mime: str) -> tuple[int, int]:
    if mime == "image/png":
        width, height = struct.unpack(">II", data[16:24])
        return int(width), int(height)
    # JPEG: walk the segments to the first start-of-frame marker.
    index = 2
    while index + 9 < len(data):
        if data[index] != 0xFF:
            index += 1
            continue
        marker = data[index + 1]
        length = int.from_bytes(data[index + 2 : index + 4], "big")
        if marker in (0xC0, 0xC1, 0xC2):
            height = int.from_bytes(data[index + 5 : index + 7], "big")
            width = int.from_bytes(data[index + 7 : index + 9], "big")
            return width, height
        index += 2 + length
    raise ValueError("no JPEG frame header")


def image_tokens(width: int, height: int) -> int:
    scale = min(1.0, MAX_EDGE / max(width, height), math.sqrt(MAX_PIXELS / (width * height)))
    return math.ceil(width * scale * height * scale / 750)


def load_settings() -> Settings:
    # The URL is only a placeholder when api/.env lacks it: nothing here talks to Supabase.
    return Settings(supabase_url="https://x.supabase.co", _env_file=API_DIR / ".env")  # type: ignore[call-arg]


def render() -> int:
    FILES_DIR.mkdir(parents=True, exist_ok=True)
    for html in sorted(SAMPLES_DIR.glob("*.html")):
        expected = json.loads(html.with_suffix(".expected.json").read_text(encoding="utf-8"))
        width, height = expected["window"]
        out = FILES_DIR / f"{html.stem}.png"
        subprocess.run(  # noqa: S603 - fixed binary, paths from this repo
            [
                CHROME,
                "--headless",
                "--disable-gpu",
                "--hide-scrollbars",
                "--force-device-scale-factor=1",
                f"--window-size={width},{height}",
                f"--screenshot={out}",
                html.resolve().as_uri(),
            ],
            check=True,
            capture_output=True,
        )
        data = out.read_bytes()
        if sniff_mime(data) != "image/png":
            print(f"{html.stem}: Chrome did not write a PNG")
            return 1
        print(f"{html.stem}: {out.relative_to(EVAL_DIR)} {image_size(data, 'image/png')}")
        # A rough stand-in for a phone photo: smaller, a little rotated, JPEG at low quality.
        photo = FILES_DIR / f"{html.stem}{PHOTO_SUFFIX}.jpg"
        subprocess.run(  # noqa: S603 - fixed binary, paths from this repo
            [
                SIPS,
                "--rotate",
                "2",
                "--resampleWidth",
                "900",
                "-s",
                "format",
                "jpeg",
                "-s",
                "formatOptions",
                "45",
                str(out),
                "--out",
                str(photo),
            ],
            check=True,
            capture_output=True,
        )
        size = image_size(photo.read_bytes(), "image/jpeg")
        print(f"{html.stem}: {photo.relative_to(EVAL_DIR)} {size}")
    return 0


def expected_for(path: Path) -> dict[str, Any] | None:
    for candidate in (
        path.with_name(f"{path.stem}.expected.json"),
        SAMPLES_DIR / f"{path.stem}.expected.json",
        SAMPLES_DIR / f"{path.stem.removesuffix(PHOTO_SUFFIX)}.expected.json",
    ):
        if candidate.exists():
            answer: dict[str, Any] = json.loads(candidate.read_text(encoding="utf-8"))
            return answer
    return None


def load_cases(settings: Settings) -> list[Case]:
    cases: list[Case] = []
    if not FILES_DIR.exists():
        return cases
    for path in sorted(FILES_DIR.iterdir()):
        mime = SUFFIX_MIME.get(path.suffix.lower())
        if mime is None:
            continue
        expected = expected_for(path)
        if expected is None:
            print(f"{path.name}: no expected answer, skipped")
            continue
        data = path.read_bytes()
        if sniff_mime(data) != mime:
            print(f"{path.name}: not a {mime} file, skipped")
            continue
        if mime in IMAGE_MIMES:
            if len(data) > settings.max_timetable_image_bytes:
                print(f"{path.name}: over max_timetable_image_bytes, skipped")
                continue
            width, height = image_size(data, mime)
            tokens = image_tokens(width, height)
            detail = f"{width}x{height}"
        else:
            pages = extract_pdf(
                data,
                max_pages=settings.max_timetable_pdf_pages,
                scanned_max_chars=settings.scanned_page_max_chars,
                max_chars_per_page=settings.max_chars_per_page,
            ).page_count
            if pages > settings.max_timetable_pdf_pages:
                print(f"{path.name}: over max_timetable_pdf_pages, skipped")
                continue
            tokens = PDF_PAGE_TOKENS * pages
            detail = f"{pages} pages"
        cases.append(
            Case(
                name=path.stem,
                path=path,
                mime=mime,
                data=data,
                expected=expected["commitments"],
                readable=expected.get("readable", True),
                input_tokens=tokens + PROMPT_TOKENS,
                detail=detail,
            )
        )
    return cases


# Spaces, hyphens and dashes, quotes, geresh and gershayim, and other punctuation.
_PUNCTUATION = re.compile("[\\s\\-\u2013\"'\u05f3\u05f4.,:;()]+")
_WORD_BREAK = re.compile("[\\s\\-\u2013]+")


def _normalize(text: str) -> str:
    return _PUNCTUATION.sub("", text).lower()


def title_matches(expected: str, got: str) -> bool:
    words = [_normalize(word) for word in _WORD_BREAK.split(expected)]
    target = _normalize(got)
    return all(word in target for word in words if word)


def score(expected: list[dict[str, Any]], got: list[TimetableItem]) -> dict[str, Any]:
    remaining = [item.to_json() for item in got]
    matched: list[tuple[dict[str, Any], dict[str, Any]]] = []
    missed: list[dict[str, Any]] = []
    for want in expected:
        key = (want["weekday"], want["start"], want["end"])
        same = [r for r in remaining if (r["weekday"], r["start"], r["end"]) == key]
        if not same:
            missed.append(want)
            continue
        best = next((r for r in same if title_matches(want["title"], r["title"])), same[0])
        remaining.remove(best)
        matched.append((want, best))
    return {
        "tp": len(matched),
        "fp": len(remaining),
        "fn": len(missed),
        "kind_ok": sum(1 for want, got_ in matched if want["kind"] == got_["kind"]),
        "title_ok": sum(1 for want, got_ in matched if title_matches(want["title"], got_["title"])),
        "missed": missed,
        "extra": remaining,
        "wrong": [
            {"expected": want, "got": got_}
            for want, got_ in matched
            if want["kind"] != got_["kind"] or not title_matches(want["title"], got_["title"])
        ],
    }


def print_estimate(cases: list[Case], prices: dict[str, dict[str, float]]) -> None:
    models = list(prices)
    print(
        f"{'file':<24} {'size':>12} {'in_tok':>7} {'out_tok':>7}"
        + "".join(f" {m:>18}" for m in models)
    )
    totals = dict.fromkeys(models, 0.0)
    for case in cases:
        costs = {m: case.estimate_usd(prices[m]) for m in models}
        for m in models:
            totals[m] += costs[m]
        print(
            f"{case.name:<24} {case.detail:>12} {case.input_tokens:>7} {OUTPUT_TOKENS:>7}"
            + "".join(f" {costs[m]:>18.4f}" for m in models)
        )
    per_model = " ".join(f"{m}={totals[m]:.4f}" for m in models)
    print(f"summary: files={len(cases)} total_usd {per_model} (x{SAFETY} with retries)")


def run_model(
    model: str,
    effort: str,
    cases: list[Case],
    price: dict[str, float],
    settings: Settings,
    api_key: str,
    max_usd: float,
    state: dict[str, float],
) -> dict[str, Any]:
    client = AnthropicAnalysisClient(
        api_key=api_key,
        model=model,
        effort=effort,
        max_tokens=settings.ai_timetable_max_tokens,
        timeout=settings.ai_timeout_seconds,
    )
    records: list[dict[str, Any]] = []
    totals = {"tp": 0, "fp": 0, "fn": 0, "kind_ok": 0, "title_ok": 0}
    counts = {
        "ok": 0,
        "timetable_unreadable": 0,
        "timetable_invalid": 0,
        "other": 0,
        "skipped": 0,
        "right_outcome": 0,
    }
    tokens = {"input": 0, "output": 0}
    cost_total = 0.0
    for case in cases:
        estimate = case.estimate_usd(price)
        if state["spent"] + estimate * SAFETY > max_usd:
            print(f"{model} {case.name}: skipped, spent={state['spent']:.4f} max={max_usd:.2f}")
            counts["skipped"] += 1
            records.append({"file": case.name, "skipped": True})
            continue
        started = time.perf_counter()
        record: dict[str, Any] = {"file": case.name, "estimate_usd": estimate}
        usage: tuple[Usage, ...]
        try:
            draft = run_timetable(client, case.data, case.mime)
        except TimetableFailed as failed:
            usage = failed.usage
            key = failed.code if failed.code in counts else "other"
            counts[key] += 1
            status = f"failed:{failed.code}"
            result = score(case.expected, [])
            record |= {"ok": False, "code": failed.code}
            right = failed.code == "timetable_unreadable" and not case.readable
        else:
            usage = draft.usage
            counts["ok"] += 1
            status = "ok"
            result = score(case.expected, list(draft.commitments))
            record |= {"ok": True, "commitments": [i.to_json() for i in draft.commitments]}
            right = case.readable
        counts["right_outcome"] += right
        record["right_outcome"] = right
        seconds = time.perf_counter() - started
        cost = sum(usage_usd(price, u) for u in usage)
        state["spent"] += cost
        cost_total += cost
        for name in totals:
            totals[name] += result[name]
        tokens["input"] += sum(u.input_tokens for u in usage)
        tokens["output"] += sum(u.output_tokens for u in usage)
        record |= {
            "score": result,
            "attempts": len(usage),
            "usage": [u.__dict__ for u in usage],
            "cost_usd": cost,
            "seconds": seconds,
        }
        records.append(record)
        print(
            f"{model} {case.name}: {status} attempts={len(usage)} "
            f"tp={result['tp']} fp={result['fp']} fn={result['fn']} "
            f"kind_ok={result['kind_ok']} title_ok={result['title_ok']} "
            f"tokens={sum(u.input_tokens for u in usage)}/{sum(u.output_tokens for u in usage)} "
            f"cost={cost:.4f} seconds={seconds:.1f}"
        )
    tp, fp, fn = totals["tp"], totals["fp"], totals["fn"]
    summary = {
        "model": model,
        "effort": effort,
        "files": len(cases),
        **counts,
        **totals,
        "precision": tp / (tp + fp) if tp + fp else None,
        "recall": tp / (tp + fn) if tp + fn else None,
        "kind_accuracy": totals["kind_ok"] / tp if tp else None,
        "title_accuracy": totals["title_ok"] / tp if tp else None,
        "input_tokens": tokens["input"],
        "output_tokens": tokens["output"],
        "cost_usd": cost_total,
    }
    return {"summary": summary, "files": records}


def _pct(value: float | None) -> str:
    return "-" if value is None else f"{value:.0%}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--render", action="store_true", help="draw the samples to PNG")
    parser.add_argument("--models", help=f"comma-separated; default: {','.join(DEFAULT_MODELS)}")
    parser.add_argument("--effort", help="default: AI_TIMETABLE_EFFORT")
    parser.add_argument("--files", help="comma-separated file names (no suffix); default: all")
    parser.add_argument("--run", action="store_true", help="make real calls (needs a key)")
    parser.add_argument("--max-usd", type=float, default=0.3)
    args = parser.parse_args()
    if args.render:
        return render()

    prices: dict[str, dict[str, float]] = json.loads((EVAL_DIR / "models.json").read_text())
    models = args.models.split(",") if args.models else list(DEFAULT_MODELS)
    unknown = [m for m in models if m not in prices]
    if unknown:
        print(f"unknown model(s) {','.join(unknown)}: add a price to eval/models.json")
        return 2
    settings = load_settings()
    effort = args.effort or settings.ai_timetable_effort
    cases = load_cases(settings)
    if args.files:
        wanted = args.files.split(",")
        cases = [case for case in cases if case.name in wanted]
        if len(cases) != len(wanted):
            print("unknown file name")
            return 2
    if not cases:
        print("no timetable files: run --render first")
        return 2
    print_estimate(cases, {m: prices[m] for m in models})
    if not args.run:
        return 0
    if settings.anthropic_api_key is None:
        print("ANTHROPIC_API_KEY is not set in api/.env")
        return 2
    api_key = settings.anthropic_api_key.get_secret_value()
    state = {"spent": 0.0}
    runs = [
        run_model(m, effort, cases, prices[m], settings, api_key, args.max_usd, state)
        for m in models
    ]
    print(
        f"{'model':<20} {'effort':<7} {'right':>5} {'ok':>3} {'unread':>6} {'invalid':>7} "
        f"{'recall':>7} {'precision':>9} {'kind':>5} {'title':>5} {'tokens':>13} {'usd':>8}"
    )
    for run in runs:
        s = run["summary"]
        print(
            f"{s['model']:<20} {s['effort']:<7} {s['right_outcome']:>2}/{s['files']:<2} "
            f"{s['ok']:>3} {s['timetable_unreadable']:>6} "
            f"{s['timetable_invalid']:>7} {_pct(s['recall']):>7} {_pct(s['precision']):>9} "
            f"{_pct(s['kind_accuracy']):>5} {_pct(s['title_accuracy']):>5} "
            f"{s['input_tokens']:>6}/{s['output_tokens']:<6} {s['cost_usd']:>8.4f}"
        )
    stamp = dt.datetime.now(dt.UTC)
    path = FILES_DIR / f"results-{stamp.strftime('%Y-%m-%d')}.json"
    previous: list[Any] = []
    if path.exists():
        previous = json.loads(path.read_text(encoding="utf-8"))
    previous.append({"at": stamp.isoformat(), "runs": runs})
    path.write_text(json.dumps(previous, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"summary: spent_usd={state['spent']:.4f} max_usd={args.max_usd:.2f}")
    print(f"results written to eval/materials/timetables/{path.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
