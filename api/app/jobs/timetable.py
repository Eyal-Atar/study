"""The parse_timetable job: read a photo or PDF of the student's weekly timetable with Claude.

The API registers the upload and queues the job with {"upload_id", "storage_path", "mime"},
where storage_path is `timetable_path(user_id, upload_id)` in the materials bucket. The job
downloads the file, checks its real type against the registered one, sends it to Claude
(AI_MODEL_TIMETABLE) as an image or a document block, and validates the answer
(app.ai.timetable). It writes nothing to the user's tables: the proposed commitments go to
jobs.result as {"commitments": [...], "model": ...}, and the student confirms them through
the API.

Every Claude call runs inside `ctx.keeping_alive()` and is written to app.ai_usage (exam_id
NULL) as soon as it returns, also when the parse then fails.

The file is not kept: it is deleted from Storage once the outcome is final (success, a
failure that will not be retried, or the last attempt of one that would be), and by the crash
callback when the worker died on the last attempt. A failed delete is logged and never fails
the job. A storage_path outside the job user's own timetables folder is refused before
anything is downloaded or deleted.

Nothing here logs the file, the path, the prompt or the answer: ids, codes and class names.
"""

import logging
from collections.abc import Callable, Mapping, Sequence
from typing import Any, Final
from uuid import UUID

from app.ai.client import AiError, AnalysisClient, AnalysisReply
from app.ai.timetable import TimetableFailed, run_timetable
from app.domain.materials import IMAGE_MIMES, PDF_MIME, TIMETABLE_FOLDER, sniff_mime
from app.jobs.pdf_text import PdfUnreadable, extract_pdf
from app.jobs.storage import FileMissing, FileTooLarge, StorageUnavailable
from app.jobs.worker import JobContext, JobFailed, JobLost

logger = logging.getLogger(__name__)

# The same interval as the analysis calls (plan_jobs.TICK_SECONDS).
TICK_SECONDS: Final = 30.0
TIMETABLE_MIMES: Final = frozenset({PDF_MIME, *IMAGE_MIMES})

FILE_MISSING: Final = "file_missing"
FILE_TOO_LARGE: Final = "file_too_large"
UNSUPPORTED_FILE: Final = "unsupported_file"
TOO_MANY_PAGES: Final = "too_many_pages"
PDF_UNREADABLE: Final = "pdf_unreadable"
STORAGE_UNAVAILABLE: Final = "storage_unavailable"
INTERNAL_ERROR: Final = "internal_error"


class _KeptAliveClient:
    """Runs every call inside the job's keepalive ticker and records each paid call at once.

    The usage is written even when the ticker found the claim lost during the call: the
    money was spent, so the row is written first and JobLost is raised after it.
    """

    def __init__(self, ctx: JobContext, client: AnalysisClient) -> None:
        self._ctx = ctx
        self._client = client

    def complete(
        self,
        *,
        system: str,
        messages: Sequence[Mapping[str, Any]],
        schema: Mapping[str, Any],
        keepalive: Callable[[], None] | None = None,
    ) -> AnalysisReply:
        reply: AnalysisReply | None = None
        try:
            with self._ctx.keeping_alive(interval=TICK_SECONDS):
                reply = self._client.complete(
                    system=system,
                    messages=messages,
                    schema=schema,
                    keepalive=keepalive if keepalive is not None else self._ctx.keepalive,
                )
        except JobLost:
            if reply is not None:
                self._ctx.record_usage([reply.usage], exam_id=None)
            raise
        self._ctx.record_usage([reply.usage], exam_id=None)
        return reply


def _own_path(ctx: JobContext) -> str:
    """The payload's storage_path, only when it is `{user_id}/timetables/{uuid}` of this job."""
    path = ctx.job.payload.get("storage_path")
    if not isinstance(path, str):
        raise JobFailed(INTERNAL_ERROR)
    parts = path.split("/")
    if len(parts) != 3 or parts[0] != str(ctx.job.user_id) or parts[1] != TIMETABLE_FOLDER:
        raise JobFailed(INTERNAL_ERROR)
    try:
        canonical = str(UUID(parts[2]))
    except ValueError:
        raise JobFailed(INTERNAL_ERROR) from None
    if canonical != parts[2]:
        raise JobFailed(INTERNAL_ERROR)
    return path


def _delete(ctx: JobContext, path: str) -> None:
    try:
        ctx.storage.delete(path)
    except Exception as exc:
        logger.warning(
            "job %s could not delete the timetable file: %s", ctx.job.id, type(exc).__name__
        )


def _download(ctx: JobContext, path: str, mime: str) -> bytes:
    # An image larger than the API's image limit cannot be sent, so it is not even read.
    limit = (
        ctx.settings.max_timetable_image_bytes
        if mime in IMAGE_MIMES
        else ctx.settings.max_material_bytes
    )
    try:
        return ctx.storage.download(path, max_bytes=limit)
    except FileMissing:
        raise JobFailed(FILE_MISSING) from None
    except FileTooLarge:
        raise JobFailed(FILE_TOO_LARGE) from None
    except StorageUnavailable:
        raise JobFailed(STORAGE_UNAVAILABLE, retry=True) from None


def _check_file(ctx: JobContext, data: bytes, mime: str) -> None:
    if sniff_mime(data) != mime:
        raise JobFailed(UNSUPPORTED_FILE)
    if mime != PDF_MIME:
        return
    max_pages = ctx.settings.max_timetable_pdf_pages
    try:
        extracted = extract_pdf(
            data,
            max_pages=max_pages,
            scanned_max_chars=ctx.settings.scanned_page_max_chars,
            max_chars_per_page=ctx.settings.max_chars_per_page,
        )
    except PdfUnreadable:
        raise JobFailed(PDF_UNREADABLE) from None
    if extracted.page_count > max_pages:
        raise JobFailed(TOO_MANY_PAGES)


def _parse(ctx: JobContext, path: str) -> dict[str, Any]:
    mime = ctx.job.payload.get("mime")
    if not isinstance(mime, str) or mime not in TIMETABLE_MIMES:
        raise JobFailed(UNSUPPORTED_FILE)

    ctx.progress("downloading", 10)
    data = _download(ctx, path, mime)
    _check_file(ctx, data, mime)

    try:
        client = ctx.timetable_ai_client()
    except AiError as error:
        raise JobFailed(error.code) from None

    ctx.progress("reading", 30)
    try:
        draft = run_timetable(_KeptAliveClient(ctx, client), data, mime)
    except TimetableFailed as failed:
        # Each call was recorded as it returned.
        raise JobFailed(failed.code, retry=failed.retry) from None
    return {
        "commitments": [item.to_json() for item in draft.commitments],
        "model": draft.model,
    }


def parse_timetable(ctx: JobContext) -> Mapping[str, Any]:
    path = _own_path(ctx)
    try:
        result = _parse(ctx, path)
    except JobFailed as exc:
        if not exc.retry or ctx.last_attempt:
            _delete(ctx, path)
        raise
    except Exception:
        # The worker logs it and retries it as internal_error, until the last attempt.
        if ctx.last_attempt:
            _delete(ctx, path)
        raise
    _delete(ctx, path)
    return result


def parse_timetable_crashed(ctx: JobContext) -> None:
    """The worker died on the last attempt: delete the file it left behind."""
    try:
        path = _own_path(ctx)
    except JobFailed:
        return
    # A failure here propagates; the worker logs it and still fails the job.
    ctx.storage.delete(path)
