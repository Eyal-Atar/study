"""Course analysis eval: the real analysis core on real local files. Numbers only on screen.

Usage, from api/:
    uv run python eval/analysis_eval.py [--models a,b] [--cases x,y]            # estimate only
    uv run python eval/analysis_eval.py --run --max-usd 5 [--models ...]        # real calls

Without --run it makes no network call and needs no key: it prints, per case, the pages, the
characters and the scan bytes the request would carry, and the estimated cost per model.
With --run it needs ANTHROPIC_API_KEY in api/.env, stops before a call whose estimate (x2.2)
would pass --max-usd, and writes the full results, titles included, to eval/results/
(git-ignored). It never prints material text, the prompt or the model's output.
"""

import argparse
import datetime as dt
import json
import struct
import sys
import time
import uuid
import zlib
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

# Running a file puts its own folder on sys.path, not api/; add api/ so that `app` imports.
API_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API_DIR))

import pypdfium2 as pdfium  # noqa: E402

from app.ai.client import AnthropicAnalysisClient, Usage  # noqa: E402
from app.ai.prompts import AnalysisRequest, ExamInfo, MaterialInput, build_request  # noqa: E402
from app.config import Settings  # noqa: E402
from app.domain.analysis import minimum_budget  # noqa: E402
from app.domain.materials import (  # noqa: E402
    PDF_MIME,
    MaterialKind,
    PageText,
    image_as_pages,
    sniff_mime,
)
from app.jobs.pdf_text import extract_pdf  # noqa: E402
from app.services.analysis import (  # noqa: E402
    KIND_ORDER,
    AnalysisFailed,
    limit_text,
    load_scans,
    run_analysis,
)

EVAL_DIR = Path(__file__).resolve().parent
MATERIALS_DIR = EVAL_DIR / "materials"
RESULTS_DIR = EVAL_DIR / "results"
SYSTEM_TOKENS = 3000
SCANNED_PAGE_TOKENS = 2500
IMAGE_TOKENS = 1600
CHARS_PER_TOKEN = 2.5
SAFETY = 2.2  # a retry resends the request and the first answer


def encode_png(width: int, height: int, rgb_rows: list[bytes]) -> bytes:
    def chunk(tag: bytes, body: bytes) -> bytes:
        crc = zlib.crc32(tag + body) & 0xFFFFFFFF
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", crc)

    raw = b"".join(b"\x00" + row for row in rgb_rows)  # filter type 0 on every row
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 6))
        + chunk(b"IEND", b"")
    )


def render_page_png(pdf_bytes: bytes, page_number: int) -> bytes:
    """Page page_number (1-based) of the PDF as an RGB PNG, rendered in memory."""
    pdf = pdfium.PdfDocument(pdf_bytes)
    try:
        bitmap = pdf[page_number - 1].render(scale=2)
        width, height, stride = bitmap.width, bitmap.height, bitmap.stride
        channels = bitmap.n_channels
        if channels not in (3, 4):
            raise ValueError("unexpected bitmap format")
        data = bytes(bitmap.buffer)
        rows: list[bytes] = []
        for y in range(height):
            line = data[y * stride : y * stride + width * channels]
            out = bytearray(width * 3)
            # pdfium writes B, G, R (and an alpha or unused byte): swap to R, G, B.
            out[0::3] = line[2::channels]
            out[1::3] = line[1::channels]
            out[2::3] = line[0::channels]
            rows.append(bytes(out))
        return encode_png(width, height, rows)
    finally:
        pdf.close()


@dataclass
class Prepared:
    case_id: str
    budget: int
    request: AnalysisRequest
    kinds: dict[str, MaterialKind]
    warnings: list[str]
    text_pages: int
    scanned_pages: int
    images: int
    chars: int
    scan_bytes: int

    def input_tokens(self) -> int:
        pdf_scanned = self.scanned_pages - self.images
        return round(
            self.chars / CHARS_PER_TOKEN
            + SCANNED_PAGE_TOKENS * pdf_scanned
            + IMAGE_TOKENS * self.images
            + SYSTEM_TOKENS
        )

    def output_tokens(self) -> int:
        return round(self.budget / 60 * 150 + 4000)

    def estimate_usd(self, price: dict[str, float]) -> float:
        return cost_usd(price, self.input_tokens(), self.output_tokens())


def cost_usd(price: dict[str, float], input_tokens: float, output_tokens: float) -> float:
    return (input_tokens * price["input"] + output_tokens * price["output"]) / 1_000_000


def usage_usd(price: dict[str, float], usage: Usage) -> float:
    # Cache writes cost 1.25x the input price and reads 0.1x (the analysis does not cache).
    input_equivalent = (
        usage.input_tokens
        + 1.25 * usage.cache_creation_input_tokens
        + 0.1 * usage.cache_read_input_tokens
    )
    return cost_usd(price, input_equivalent, usage.output_tokens)


def build_material(
    spec: dict[str, Any], index: int, settings: Settings
) -> tuple[MaterialInput, bytes]:
    kind = MaterialKind(spec["kind"])
    if "text" in spec:
        text = str(spec["text"])
        pages = (PageText(page=1, text=text, scanned=False),)
        return (
            MaterialInput(
                key="",
                id=uuid.uuid4(),
                kind=kind,
                filename=spec["filename"],
                mime="text/plain",
                pages=pages,
                page_count=1,
            ),
            b"",
        )
    if "render" in spec:
        source = (MATERIALS_DIR / spec["render"]["path"]).read_bytes()
        png = render_page_png(source, int(spec["render"]["page"]))
        if sniff_mime(png) != "image/png" or not 1_000 < len(png) < settings.max_material_bytes:
            raise SystemExit(f"rendered image of material {index + 1} is not a sane PNG")
        extracted = image_as_pages()
        return (
            MaterialInput(
                key="",
                id=uuid.uuid4(),
                kind=kind,
                filename=spec["filename"],
                mime="image/png",
                pages=extracted.pages,
                page_count=extracted.page_count,
            ),
            png,
        )
    path = MATERIALS_DIR / spec["path"]
    data = path.read_bytes()
    extracted = extract_pdf(
        data,
        max_pages=settings.max_material_pages,
        scanned_max_chars=settings.scanned_page_max_chars,
        max_chars_per_page=settings.max_chars_per_page,
    )
    return (
        MaterialInput(
            key="",
            id=uuid.uuid4(),
            kind=kind,
            filename=spec.get("filename", path.name),
            mime=PDF_MIME,
            pages=extracted.pages,
            page_count=extracted.page_count,
        ),
        data,
    )


def prepare(case: dict[str, Any], settings: Settings) -> Prepared:
    built = [build_material(spec, i, settings) for i, spec in enumerate(case["materials"])]
    # The service lists materials by kind (KIND_ORDER), then by upload time: here, case order.
    built.sort(key=lambda item: KIND_ORDER.index(item[0].kind))
    materials: list[MaterialInput] = []
    files: dict[str, bytes] = {}
    for number, (material, data) in enumerate(built, start=1):
        key = f"M{number}"
        materials.append(replace(material, key=key))
        files[key] = data
    scans, scan_warnings = load_scans(materials, lambda m: files[m.key], settings)
    limited, text_warnings = limit_text(materials, settings.max_analysis_text_chars)
    exam = case["exam"]
    # The same cap and floor as analyze_exam.
    budget = min(int(case["budget_minutes"]), settings.max_analysis_minutes)
    budget = max(budget, minimum_budget({m.key: m.kind for m in materials}))
    request = build_request(
        ExamInfo(
            name=exam["name"],
            exam_date=dt.date.fromisoformat(exam["exam_date"]),
            difficulty=int(exam["difficulty"]),
        ),
        budget,
        limited,
        scans,
        today=dt.date.fromisoformat(case["today"]),
    )
    pages = [page for m in limited for page in m.pages]
    return Prepared(
        case_id=case["id"],
        budget=budget,
        request=request,
        kinds={m.key: m.kind for m in limited},
        warnings=[*scan_warnings, *text_warnings],
        text_pages=sum(1 for p in pages if not p.scanned),
        scanned_pages=sum(len(s.pages) if s.media_type == PDF_MIME else 1 for s in scans.values()),
        images=sum(1 for s in scans.values() if s.media_type != PDF_MIME),
        chars=sum(len(p.text) for p in pages if not p.scanned),
        scan_bytes=sum(len(s.data) for s in scans.values()),
    )


def load_settings() -> Settings:
    # The URL is only a placeholder when api/.env lacks it: nothing here talks to Supabase.
    return Settings(supabase_url="https://x.supabase.co", _env_file=API_DIR / ".env")  # type: ignore[call-arg]


def print_estimate(prepared: list[Prepared], prices: dict[str, dict[str, float]]) -> None:
    models = list(prices)
    header = (
        f"{'case':<24} {'text_pg':>7} {'scan_pg':>7} {'chars':>8} "
        f"{'scan_kB':>8} {'in_tok':>8} {'out_tok':>8}"
    )
    print(header + "".join(f" {m[7:]:>10}" for m in models))
    totals = dict.fromkeys(models, 0.0)
    for item in prepared:
        costs = {m: item.estimate_usd(prices[m]) for m in models}
        for m in models:
            totals[m] += costs[m]
        print(
            f"{item.case_id:<24} {item.text_pages:>7} {item.scanned_pages:>7} {item.chars:>8} "
            f"{item.scan_bytes // 1024:>8} {item.input_tokens():>8} {item.output_tokens():>8}"
            + "".join(f" {costs[m]:>10.3f}" for m in models)
        )
    per_model = " ".join(f"{m}={totals[m]:.3f}" for m in models)
    print(
        f"summary: cases={len(prepared)} total_usd {per_model} "
        f"all_models={sum(totals.values()):.3f}"
    )


def run_model(
    model: str,
    prepared: list[Prepared],
    prices: dict[str, dict[str, float]],
    settings: Settings,
    api_key: str,
    max_usd: float,
    state: dict[str, float],
) -> None:
    client = AnthropicAnalysisClient(
        api_key=api_key,
        model=model,
        effort=settings.ai_analysis_effort,
        max_tokens=settings.ai_analysis_max_tokens,
        timeout=settings.ai_timeout_seconds,
    )
    price = prices[model]
    results: list[dict[str, Any]] = []
    for item in prepared:
        estimate = item.estimate_usd(price)
        if state["spent"] + estimate * SAFETY > max_usd:
            print(
                f"{model} {item.case_id}: skipped, spent={state['spent']:.3f} "
                f"estimate={estimate:.3f} max_usd={max_usd:.2f}"
            )
            results.append({"case": item.case_id, "skipped": True, "estimate_usd": estimate})
            continue
        started = time.perf_counter()
        record: dict[str, Any] = {"case": item.case_id, "estimate_usd": estimate}
        usage: tuple[Usage, ...]
        try:
            draft = run_analysis(client, item.request, materials=item.kinds, budget=item.budget)
            usage = draft.usage
            warnings = list(dict.fromkeys([*item.warnings, *draft.warnings]))
            titles = [t.title for t in draft.output.tasks]
            record |= {
                "ok": True,
                "topics": [t.model_dump() for t in draft.output.topics],
                "tasks": [t.model_dump() for t in draft.output.tasks],
                "gaps": [g.model_dump() for g in draft.output.gaps],
                "dropped": list(draft.dropped),
                "minutes": draft.total_minutes,
                "warnings": warnings,
            }
            status = "ok"
            counts = f"topics={len(draft.output.topics)} tasks={len(titles)}"
            minutes = f"minutes={draft.total_minutes}/{item.budget}"
            hacked = any("HACKED" in t for t in titles) or any(
                "HACKED" in t.name for t in draft.output.topics
            )
            record["hacked_in_title"] = hacked
        except AnalysisFailed as failed:
            usage = failed.usage
            status = f"failed:{failed.code}"
            counts, minutes, hacked = "topics=- tasks=-", "minutes=-", False
            warnings = list(item.warnings)
            record |= {"ok": False, "code": failed.code, "retry": failed.retry}
        except Exception as error:  # a bug in the eval or the core: the class name only
            print(f"{model} {item.case_id}: crashed {type(error).__name__}")
            record |= {"ok": False, "code": f"crash:{type(error).__name__}"}
            results.append(record)
            continue
        seconds = time.perf_counter() - started
        cost = sum(usage_usd(price, u) for u in usage)
        state["spent"] += cost
        tokens_in = sum(u.input_tokens for u in usage)
        tokens_out = sum(u.output_tokens for u in usage)
        record |= {
            "attempts": len(usage),
            "usage": [u.__dict__ for u in usage],
            "cost_usd": cost,
            "seconds": seconds,
        }
        results.append(record)
        injection = (
            f" hacked={'yes' if hacked else 'no'}" if item.case_id == "prompt_injection" else ""
        )
        print(
            f"{model} {item.case_id}: {status} attempts={len(usage)} {counts} {minutes} "
            f"warnings={','.join(warnings) or '-'} tokens={tokens_in}/{tokens_out} "
            f"cost={cost:.3f} seconds={seconds:.1f}{injection}"
        )
    RESULTS_DIR.mkdir(exist_ok=True)
    stamp = dt.datetime.now(dt.UTC).strftime("%Y%m%dT%H%M%SZ")
    path = RESULTS_DIR / f"{stamp}-{model}.json"
    path.write_text(
        json.dumps({"model": model, "results": results}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"{model}: results written to eval/results/{path.name}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--models", help="comma-separated; default: every model in models.json")
    parser.add_argument("--cases", help="comma-separated case ids; default: all")
    parser.add_argument("--run", action="store_true", help="make real calls (needs a key)")
    parser.add_argument("--max-usd", type=float, default=5.0)
    args = parser.parse_args()

    prices: dict[str, dict[str, float]] = json.loads((EVAL_DIR / "models.json").read_text())
    models = args.models.split(",") if args.models else list(prices)
    unknown = [m for m in models if m not in prices]
    if unknown:
        print(f"unknown model(s) {','.join(unknown)}: add a price to eval/models.json")
        return 2
    cases: list[dict[str, Any]] = json.loads((EVAL_DIR / "analysis_cases.json").read_text())
    if args.cases:
        wanted = args.cases.split(",")
        cases = [c for c in cases if c["id"] in wanted]
        if len(cases) != len(wanted):
            print("unknown case id")
            return 2

    settings = load_settings()
    api_key = ""
    if args.run:
        if settings.anthropic_api_key is None:
            print("ANTHROPIC_API_KEY is not set in api/.env")
            return 2
        api_key = settings.anthropic_api_key.get_secret_value()

    prepared = [prepare(case, settings) for case in cases]
    print_estimate(prepared, {m: prices[m] for m in models})
    if args.run:
        state = {"spent": 0.0}
        for model in models:
            run_model(model, prepared, prices, settings, api_key, args.max_usd, state)
        print(f"summary: spent_usd={state['spent']:.3f} max_usd={args.max_usd:.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
