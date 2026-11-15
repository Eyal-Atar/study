"""Course analysis with Claude: read an exam's materials as the user, ask once (and retry
once), validate and trim the answer, and save its topics and tasks in one transaction.

No transaction is open while Storage or Claude is called: those calls take seconds to
minutes, and every transaction runs under a 5 s statement timeout. Nothing from the
materials or from the model reaches a log or an error message: only codes and keys.
"""

import datetime as dt
import logging
from collections.abc import Callable, Mapping, Sequence
from contextlib import AbstractContextManager
from dataclasses import dataclass, field, replace
from typing import Any, Final
from uuid import UUID

import psycopg

from app.ai.client import AiError, AnalysisClient, AnalysisReply, Usage
from app.ai.prompts import (
    AnalysisRequest,
    ExamInfo,
    MaterialInput,
    Scan,
    build_request,
    retry_message,
)
from app.ai.schema import AnalysisOutput, GapOut, TaskOut, parse_output
from app.config import Settings
from app.domain.analysis import (
    WARNING_MATERIALS_NOT_READY,
    WARNING_SCANNED_PAGES_SKIPPED,
    WARNING_TEXT_TRUNCATED,
    WARNING_TRIMMED,
    WARNING_UNDER_BUDGET,
    TrimResult,
    budget_range,
    trim_to_budget,
    validate_analysis,
)
from app.domain.materials import IMAGE_MIMES, PDF_MIME, IngestStatus, MaterialKind, PageText
from app.jobs.pdf_text import PdfUnreadable, pdf_subset
from app.jobs.storage import FileMissing, FileTooLarge, Storage, StorageUnavailable
from app.services.profiles import Conn, lock_user

logger = logging.getLogger(__name__)

MAX_ATTEMPTS: Final = 2

# The order materials are listed in, and get their keys M1, M2, ... in: the syllabus
# defines the topics, so it comes first; what is cut first (from the end) is notes and other.
KIND_ORDER: Final = (
    MaterialKind.SYLLABUS,
    MaterialKind.SUMMARY,
    MaterialKind.PAST_EXAM,
    MaterialKind.SOLUTION,
    MaterialKind.NOTES,
    MaterialKind.OTHER,
)

ERROR_TRUNCATED: Final = "response_truncated"
ERROR_INVALID_JSON: Final = "invalid_json"


class AnalysisFailed(Exception):
    def __init__(self, code: str, *, retry: bool = False, usage: Sequence[Usage] = ()) -> None:
        super().__init__(code)
        self.code = code
        self.retry = retry
        self.usage: tuple[Usage, ...] = tuple(usage)


@dataclass(frozen=True)
class AnalysisInput:
    exam: ExamInfo
    materials: tuple[MaterialInput, ...]
    skipped: int
    # Material key -> storage path, for the fetch of scanned pages. Kept out of
    # MaterialInput, which describes what the request is built from.
    storage_paths: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class AnalysisDraft:
    output: AnalysisOutput
    dropped: tuple[str, ...]
    total_minutes: int
    warnings: tuple[str, ...]
    usage: tuple[Usage, ...]


@dataclass(frozen=True)
class SavedAnalysis:
    topic_ids: dict[str, UUID]
    task_ids: dict[str, UUID]


@dataclass(frozen=True)
class AnalysisOutcome:
    topic_ids: dict[str, UUID]
    task_ids: dict[str, UUID]
    gaps: tuple[GapOut, ...]
    warnings: tuple[str, ...]
    dropped: tuple[str, ...]
    total_minutes: int
    budget_minutes: int
    usage: tuple[Usage, ...]


def _exam_is_live(conn: Conn, user_id: UUID, exam_id: UUID) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT name, exam_date, difficulty FROM app.exams "
        "WHERE user_id = %s AND id = %s AND deleted_at IS NULL",
        (user_id, exam_id),
    ).fetchone()
    return dict(row) if row is not None else None


def _has_ai_tasks(conn: Conn, user_id: UUID, exam_id: UUID) -> bool:
    row = conn.execute(
        "SELECT EXISTS (SELECT 1 FROM app.tasks WHERE user_id = %s AND exam_id = %s "
        "AND source = 'ai' AND deleted_at IS NULL) AS found",
        (user_id, exam_id),
    ).fetchone()
    return bool(row is not None and row["found"])


def _pages(raw: object) -> tuple[PageText, ...]:
    if not isinstance(raw, list):
        return ()
    return tuple(
        PageText(page=int(item["page"]), text=str(item["text"]), scanned=bool(item["scanned"]))
        for item in raw
    )


def load_input(conn: Conn, user_id: UUID, exam_id: UUID) -> AnalysisInput:
    exam = _exam_is_live(conn, user_id, exam_id)
    if exam is None:
        raise AnalysisFailed("exam_missing")
    # Checked again under the lock in save_analysis; here it saves a paid call.
    if _has_ai_tasks(conn, user_id, exam_id):
        raise AnalysisFailed("already_analyzed")
    rows = conn.execute(
        "SELECT id, kind, filename, mime, storage_path, ingest_status, page_count, text_by_page "
        "FROM app.materials WHERE user_id = %s AND exam_id = %s "
        "ORDER BY array_position(%s::text[], kind), created_at, id",
        (user_id, exam_id, [kind.value for kind in KIND_ORDER]),
    ).fetchall()
    materials: list[MaterialInput] = []
    paths: dict[str, str] = {}
    skipped = 0
    for row in rows:
        if row["ingest_status"] != IngestStatus.READY:
            skipped += 1
            continue
        key = f"M{len(materials) + 1}"
        pages = _pages(row["text_by_page"])
        materials.append(
            MaterialInput(
                key=key,
                id=row["id"],
                kind=MaterialKind(row["kind"]),
                filename=row["filename"],
                mime=row["mime"],
                pages=pages,
                page_count=row["page_count"] if row["page_count"] is not None else len(pages),
            )
        )
        paths[key] = row["storage_path"]
    return AnalysisInput(
        exam=ExamInfo(
            name=exam["name"], exam_date=exam["exam_date"], difficulty=exam["difficulty"]
        ),
        materials=tuple(materials),
        skipped=skipped,
        storage_paths=paths,
    )


def _fetch(fetch: Callable[[MaterialInput], bytes], material: MaterialInput) -> bytes:
    try:
        return fetch(material)
    except StorageUnavailable:
        raise AnalysisFailed("storage_unavailable", retry=True) from None
    except FileMissing, FileTooLarge:
        # A ready material was ingested under the same size limit, so a file over it now
        # is not the file that was ingested: it counts as missing.
        raise AnalysisFailed("file_missing") from None


def load_scans(
    materials: Sequence[MaterialInput],
    fetch: Callable[[MaterialInput], bytes],
    settings: Settings,
) -> tuple[dict[str, Scan], list[str]]:
    """The scanned pages of each material, within the request's page and byte limits.

    Materials are taken in order, so what does not fit is cut from the last one back.
    """
    pages_left = settings.max_analysis_scanned_pages
    bytes_left = settings.max_analysis_scan_bytes
    scans: dict[str, Scan] = {}
    skipped = False
    for material in materials:
        scanned = [page.page for page in material.pages if page.scanned]
        if not scanned:
            continue
        if material.mime in IMAGE_MIMES:
            if pages_left < 1:
                skipped = True
                continue
            data = _fetch(fetch, material)
            if len(data) > bytes_left:
                skipped = True
                continue
            scans[material.key] = Scan(media_type=material.mime, data=data, pages=(1,))
            pages_left -= 1
            bytes_left -= len(data)
            continue
        if material.mime != PDF_MIME:
            continue
        taken = scanned[:pages_left]
        if len(taken) < len(scanned):
            skipped = True
        if not taken:
            continue
        try:
            subset = pdf_subset(_fetch(fetch, material), taken)
        except PdfUnreadable:
            raise AnalysisFailed("pdf_unreadable") from None
        if len(subset) > bytes_left:
            skipped = True
            continue
        scans[material.key] = Scan(media_type=PDF_MIME, data=subset, pages=tuple(taken))
        pages_left -= len(taken)
        bytes_left -= len(subset)
    return scans, [WARNING_SCANNED_PAGES_SKIPPED] if skipped else []


def limit_text(
    materials: Sequence[MaterialInput], max_chars: int
) -> tuple[tuple[MaterialInput, ...], list[str]]:
    """Cut text over max_chars, from the last page of the last material back."""
    excess = sum(len(page.text) for m in materials for page in m.pages if not page.scanned)
    excess -= max_chars
    if excess <= 0:
        return tuple(materials), []
    result = list(materials)
    for index in range(len(result) - 1, -1, -1):
        if excess <= 0:
            break
        pages = list(result[index].pages)
        for p in range(len(pages) - 1, -1, -1):
            if excess <= 0:
                break
            page = pages[p]
            if page.scanned or not page.text:
                continue
            cut = min(len(page.text), excess)
            pages[p] = replace(page, text=page.text[: len(page.text) - cut])
            excess -= cut
        result[index] = replace(result[index], pages=tuple(pages))
    return tuple(result), [WARNING_TEXT_TRUNCATED]


def _check(
    reply: AnalysisReply, materials: Mapping[str, MaterialKind], budget: int
) -> TrimResult | list[str]:
    if reply.stop_reason == "max_tokens":
        return [ERROR_TRUNCATED]
    if reply.text is None:
        return [ERROR_INVALID_JSON]
    parsed = parse_output(reply.text)
    if isinstance(parsed, list):
        return parsed
    errors = validate_analysis(parsed, materials=materials)
    if errors:
        return errors
    return trim_to_budget(parsed, budget)


def run_analysis(
    client: AnalysisClient,
    request: AnalysisRequest,
    *,
    materials: Mapping[str, MaterialKind],
    budget: int,
    progress: Callable[[str, int], None] | None = None,
) -> AnalysisDraft:
    usage: list[Usage] = []
    messages: list[dict[str, Any]] = [{"role": "user", "content": list(request.content)}]
    for attempt in range(MAX_ATTEMPTS):
        try:
            reply = client.complete(system=request.system, messages=messages, schema=request.schema)
        except AiError as error:
            raise AnalysisFailed(error.code, retry=error.retry, usage=usage) from None
        usage.append(reply.usage)
        if progress is not None:
            progress("validating", 80)
        if reply.stop_reason == "refusal":
            raise AnalysisFailed("ai_refused", usage=usage)
        result = _check(reply, materials, budget)
        if isinstance(result, TrimResult):
            warnings: list[str] = []
            if result.dropped:
                warnings.append(WARNING_TRIMMED)
            if result.total_minutes < budget_range(budget)[0]:
                warnings.append(WARNING_UNDER_BUDGET)
            return AnalysisDraft(
                output=result.output,
                dropped=result.dropped,
                total_minutes=result.total_minutes,
                warnings=tuple(warnings),
                usage=tuple(usage),
            )
        if attempt + 1 < MAX_ATTEMPTS:
            # The previous answer goes back as is (thinking blocks included).
            messages = [
                *messages,
                {"role": "assistant", "content": reply.content},
                {"role": "user", "content": retry_message(result)},
            ]
    raise AnalysisFailed("analysis_invalid", usage=usage)


def _topological(tasks: Sequence[TaskOut]) -> list[tuple[int, TaskOut]]:
    """(position, task) with every task after the task it depends on."""
    pending = list(enumerate(tasks, start=1))
    done: set[str] = set()
    ordered: list[tuple[int, TaskOut]] = []
    while pending:
        ready = [(i, t) for i, t in pending if t.depends_on is None or t.depends_on in done]
        if not ready:
            # validate_analysis rejects cycles and unknown keys before this point.
            raise RuntimeError("the tasks' dependencies do not form an order")
        for item in ready:
            ordered.append(item)
            done.add(item[1].key)
        pending = [item for item in pending if item[1].key not in done]
    return ordered


def _new_id(row: Mapping[str, Any] | None) -> UUID:
    if row is None:
        raise RuntimeError("the new row is not visible to this user")
    new_id: UUID = row["id"]
    return new_id


def save_analysis(
    conn: Conn,
    user_id: UUID,
    exam_id: UUID,
    draft: AnalysisDraft,
    material_ids: Mapping[str, UUID],
) -> SavedAnalysis:
    lock_user(conn, user_id)
    if _exam_is_live(conn, user_id, exam_id) is None:
        raise AnalysisFailed("exam_missing")
    if _has_ai_tasks(conn, user_id, exam_id):
        raise AnalysisFailed("already_analyzed")

    # A material deleted during the call loses its link, not the task built on it.
    rows = conn.execute(
        "SELECT id FROM app.materials WHERE user_id = %s AND exam_id = %s AND id = ANY(%s) "
        "FOR KEY SHARE",
        (user_id, exam_id, list(material_ids.values())),
    ).fetchall()
    live = {row["id"] for row in rows}

    topic_ids: dict[str, UUID] = {}
    for position, topic in enumerate(draft.output.topics, start=1):
        row = conn.execute(
            "INSERT INTO app.topics (user_id, exam_id, name, weight, evidence, position) "
            "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
            (user_id, exam_id, topic.name, topic.weight, topic.evidence or None, position),
        ).fetchone()
        topic_ids[topic.key] = _new_id(row)

    task_ids: dict[str, UUID] = {}
    for position, task in _topological(draft.output.tasks):
        material_id = material_ids.get(task.material_key) if task.material_key else None
        row = conn.execute(
            "INSERT INTO app.tasks (user_id, exam_id, title, kind, estimated_minutes, focus, "
            "depends_on_task_id, source, topic_id, material_id, position) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, 'ai', %s, %s, %s) RETURNING id",
            (
                user_id,
                exam_id,
                task.title,
                task.kind,
                task.minutes,
                task.focus,
                task_ids[task.depends_on] if task.depends_on else None,
                topic_ids[task.topic_key] if task.topic_key else None,
                material_id if material_id in live else None,
                position,
            ),
        ).fetchone()
        task_ids[task.key] = _new_id(row)
    return SavedAnalysis(topic_ids=topic_ids, task_ids=task_ids)


def _log_save_error(error: Exception) -> None:
    if isinstance(error, psycopg.Error):
        constraint = error.diag.constraint_name if error.diag is not None else None
        logger.error(
            "analysis save failed: %s sqlstate=%s constraint=%s",
            type(error).__name__,
            error.sqlstate,
            constraint,
        )
    else:
        logger.error("analysis save failed: %s", type(error).__name__)


def _unique(items: Sequence[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(items))


def analyze_exam(
    *,
    transaction: Callable[[], AbstractContextManager[Conn]],
    storage: Storage,
    client: AnalysisClient,
    settings: Settings,
    user_id: UUID,
    exam_id: UUID,
    budget_minutes: int,
    today: dt.date,
    progress: Callable[[str, int], None] | None = None,
) -> AnalysisOutcome:
    budget = min(budget_minutes, settings.max_analysis_minutes)
    if budget <= 0:
        raise AnalysisFailed("no_study_time")

    if progress is not None:
        progress("reading_materials", 5)
    with transaction() as conn:
        data = load_input(conn, user_id, exam_id)

    def fetch(material: MaterialInput) -> bytes:
        return storage.download(
            data.storage_paths[material.key], max_bytes=settings.max_material_bytes
        )

    scans, scan_warnings = load_scans(data.materials, fetch, settings)
    materials, text_warnings = limit_text(data.materials, settings.max_analysis_text_chars)
    request = build_request(data.exam, budget, materials, scans, today=today)

    if progress is not None:
        progress("analyzing", 15)
    draft = run_analysis(
        client,
        request,
        materials={m.key: m.kind for m in materials},
        budget=budget,
        progress=progress,
    )

    if progress is not None:
        progress("saving", 90)
    try:
        with transaction() as conn:
            saved = save_analysis(conn, user_id, exam_id, draft, {m.key: m.id for m in materials})
    except AnalysisFailed as failed:
        # The call was paid for: the usage goes with the failure.
        raise AnalysisFailed(failed.code, retry=failed.retry, usage=draft.usage) from None
    except Exception as error:
        # The message (and a psycopg DETAIL) can quote model-written titles: log only the
        # class, the SQLSTATE and the constraint. No retry: it would pay for a new analysis.
        _log_save_error(error)
        raise AnalysisFailed("internal_error", usage=draft.usage) from None

    warnings = [WARNING_MATERIALS_NOT_READY] if data.skipped > 0 else []
    warnings += scan_warnings + text_warnings + list(draft.warnings)
    return AnalysisOutcome(
        topic_ids=saved.topic_ids,
        task_ids=saved.task_ids,
        gaps=tuple(draft.output.gaps),
        warnings=_unique(warnings),
        dropped=draft.dropped,
        total_minutes=draft.total_minutes,
        budget_minutes=budget,
        usage=draft.usage,
    )
