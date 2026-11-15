"""The material jobs: ingest an uploaded file, and delete a file whose material was removed.

`ingest_material` downloads the file, checks its real type against the registered one,
extracts text per page (or treats an image as one scanned page) and writes the result into
app.materials. Every read and write of a material runs as the job's user, under RLS, and also
filters on that user explicitly, so a forged payload naming another user's material finds
nothing. The material's own status follows the job's: `processing` while it runs, back to
`queued` when the job will be retried, and `failed` with the job's code when it will not.

Nothing here logs extracted text, filenames or payload contents.
"""

import logging
from collections.abc import Mapping
from typing import Any, Final
from uuid import UUID

from psycopg.types.json import Jsonb

from app.domain.materials import (
    IMAGE_MIMES,
    JOB_DELETE_MATERIAL_FILE,
    JOB_GENERATE_PLAN,
    JOB_INGEST_MATERIAL,
    JOB_REANALYZE_EXAM,
    PDF_MIME,
    ExtractedText,
    IngestStatus,
    image_as_pages,
    sniff_mime,
)
from app.jobs.pdf_text import PdfUnreadable, extract_pdf
from app.jobs.plan_jobs import generate_plan, reanalyze_exam
from app.jobs.storage import FileMissing, FileTooLarge, StorageUnavailable
from app.jobs.worker import CrashHandler, Handler, JobContext, JobFailed

logger = logging.getLogger(__name__)

_MATERIAL_MISSING: Final = "material_missing"
# app.materials.page_count is CHECK (page_count BETWEEN 0 AND 10000).
MAX_PAGE_COUNT: Final = 10_000


def _result(
    material_id: UUID, page_count: int, scanned_pages: int, warnings: list[str]
) -> dict[str, Any]:
    return {
        "material_id": str(material_id),
        "page_count": page_count,
        "scanned_pages": scanned_pages,
        "warnings": warnings,
    }


def _material_id(ctx: JobContext) -> UUID:
    try:
        return UUID(str(ctx.job.payload["material_id"]))
    except KeyError, ValueError:
        raise JobFailed(_MATERIAL_MISSING) from None


def _start(ctx: JobContext, material_id: UUID) -> tuple[str, str] | dict[str, Any]:
    """Lock the material and mark it processing: its (path, mime), or the result if ready."""
    with ctx.user_transaction() as conn:
        row = conn.execute(
            "SELECT id, storage_path, mime, ingest_status, page_count, scanned_pages, warnings "
            "FROM app.materials WHERE user_id = %s AND id = %s FOR UPDATE",
            (ctx.job.user_id, material_id),
        ).fetchone()
        if row is None:
            raise JobFailed(_MATERIAL_MISSING)
        if row["ingest_status"] == IngestStatus.READY:
            return _result(
                material_id, row["page_count"], row["scanned_pages"], list(row["warnings"])
            )
        conn.execute(
            "UPDATE app.materials SET ingest_status = %s, ingest_error = NULL "
            "WHERE user_id = %s AND id = %s",
            (IngestStatus.PROCESSING, ctx.job.user_id, material_id),
        )
        return row["storage_path"], row["mime"]


def _download(ctx: JobContext, path: str) -> bytes:
    try:
        return ctx.storage.download(path, max_bytes=ctx.settings.max_material_bytes)
    except FileMissing:
        raise JobFailed("file_missing") from None
    except FileTooLarge:
        raise JobFailed("file_too_large") from None
    except StorageUnavailable:
        raise JobFailed("storage_unavailable", retry=True) from None


def _extract(ctx: JobContext, data: bytes, registered_mime: str) -> ExtractedText:
    detected = sniff_mime(data)
    # The stored mime is what later scopes send on, so the file must be exactly that type.
    if detected != registered_mime:
        # Not a supported file, or registered as another type (a PDF as an image, a JPEG as
        # a PNG, ...).
        raise JobFailed("unsupported_file")
    if detected in IMAGE_MIMES:
        return image_as_pages()
    if detected != PDF_MIME:
        raise JobFailed("unsupported_file")
    try:
        extracted = extract_pdf(
            data,
            max_pages=ctx.settings.max_material_pages,
            scanned_max_chars=ctx.settings.scanned_page_max_chars,
            max_chars_per_page=ctx.settings.max_chars_per_page,
        )
    except PdfUnreadable:
        raise JobFailed("pdf_unreadable") from None
    # page_count is the real count and the column allows at most MAX_PAGE_COUNT; checking
    # here fails such a file once, instead of three attempts that each hit the CHECK.
    if extracted.page_count > MAX_PAGE_COUNT:
        raise JobFailed("unsupported_file")
    return extracted


def _save(ctx: JobContext, material_id: UUID, extracted: ExtractedText) -> None:
    with ctx.user_transaction() as conn:
        cursor = conn.execute(
            "UPDATE app.materials SET ingest_status = %s, ingest_error = NULL, page_count = %s, "
            "scanned_pages = %s, warnings = %s, text_by_page = %s, ingested_at = %s "
            "WHERE user_id = %s AND id = %s",
            (
                IngestStatus.READY,
                extracted.page_count,
                extracted.scanned_pages,
                list(extracted.warnings),
                Jsonb(extracted.to_json()),
                ctx.now,
                ctx.job.user_id,
                material_id,
            ),
        )
        if cursor.rowcount == 0:
            raise JobFailed(_MATERIAL_MISSING)


def _record_failure(ctx: JobContext, material_id: UUID, code: str, *, retry: bool) -> None:
    """Mirror the job's outcome on the material; a material that is gone is left alone."""
    if retry and not ctx.last_attempt:
        status, error = IngestStatus.QUEUED, None
    else:
        status, error = IngestStatus.FAILED, code
    try:
        with ctx.user_transaction() as conn:
            conn.execute(
                "UPDATE app.materials SET ingest_status = %s, ingest_error = %s "
                "WHERE user_id = %s AND id = %s",
                (status, error, ctx.job.user_id, material_id),
            )
    except Exception as exc:
        # The caller re-raises the original failure; this one is only logged.
        logger.warning(
            "job %s could not record the material's failure: %s", ctx.job.id, type(exc).__name__
        )


def _ingest(ctx: JobContext, material_id: UUID) -> dict[str, Any]:
    started = _start(ctx, material_id)
    if isinstance(started, dict):
        return started
    path, mime = started

    ctx.progress("downloading", 10)
    data = _download(ctx, path)

    ctx.progress("extracting", 50)
    extracted = _extract(ctx, data, mime)

    ctx.progress("saving", 90)
    _save(ctx, material_id, extracted)
    return _result(
        material_id, extracted.page_count, extracted.scanned_pages, list(extracted.warnings)
    )


def ingest_material(ctx: JobContext) -> Mapping[str, Any]:
    material_id = _material_id(ctx)
    try:
        return _ingest(ctx, material_id)
    except JobFailed as exc:
        _record_failure(ctx, material_id, exc.code, retry=exc.retry)
        raise
    except Exception:
        # The worker logs it and retries it as internal_error, so the material does the same.
        _record_failure(ctx, material_id, "internal_error", retry=True)
        raise


def ingest_material_crashed(ctx: JobContext) -> None:
    """The worker died on the last attempt: fail a material it left unfinished.

    Unfinished is `processing`, or `queued` when the worker died between claiming this last
    attempt and starting it (an earlier attempt's retry had put the material back to queued).
    A `ready` or `failed` material is left alone.
    """
    try:
        material_id = _material_id(ctx)
    except JobFailed:
        return
    with ctx.user_transaction() as conn:
        conn.execute(
            "UPDATE app.materials SET ingest_status = %s, ingest_error = 'worker_crashed' "
            "WHERE user_id = %s AND id = %s AND ingest_status IN (%s, %s)",
            (
                IngestStatus.FAILED,
                ctx.job.user_id,
                material_id,
                IngestStatus.QUEUED,
                IngestStatus.PROCESSING,
            ),
        )


def delete_material_file(ctx: JobContext) -> Mapping[str, Any]:
    path = ctx.job.payload.get("storage_path")
    # Only inside the job's own user folder, even if the payload was forged; a ".." segment
    # could climb out of it if anything on the way resolved the path.
    if (
        not isinstance(path, str)
        or not path.startswith(f"{ctx.job.user_id}/")
        or ".." in path.split("/")
    ):
        raise JobFailed(_MATERIAL_MISSING)
    try:
        ctx.storage.delete(path)
    except StorageUnavailable:
        raise JobFailed("storage_unavailable", retry=True) from None
    # Nothing back: GET /jobs/{id} exposes the result, and responses never carry a path.
    return {}


HANDLERS: Final[Mapping[str, Handler]] = {
    JOB_INGEST_MATERIAL: ingest_material,
    JOB_DELETE_MATERIAL_FILE: delete_material_file,
    JOB_GENERATE_PLAN: generate_plan,
    JOB_REANALYZE_EXAM: reanalyze_exam,
}

# generate_plan and reanalyze_exam need no crash callback: they leave no row in an
# in-between state, so failing the job as worker_crashed is all there is to do.

ON_CRASHED: Final[Mapping[str, CrashHandler]] = {JOB_INGEST_MATERIAL: ingest_material_crashed}
