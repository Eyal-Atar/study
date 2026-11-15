"""Study-material rules: kinds, ingest states, file sniffing and per-page text.

Pure logic: no database, no network, no PDF library.
"""

import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Final


class MaterialKind(StrEnum):
    SYLLABUS = "syllabus"
    SUMMARY = "summary"
    PAST_EXAM = "past_exam"
    SOLUTION = "solution"
    NOTES = "notes"
    OTHER = "other"


class IngestStatus(StrEnum):
    QUEUED = "queued"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


PDF_MIME: Final = "application/pdf"
IMAGE_MIMES: Final = frozenset({"image/jpeg", "image/png"})
SUPPORTED_MIME_TYPES: Final = frozenset({PDF_MIME, *IMAGE_MIMES})

WARNING_PAGES_TRUNCATED: Final = "pages_truncated"
WARNING_TEXT_TRUNCATED: Final = "text_truncated"

# Job names, shared by the code that enqueues jobs and the worker that runs them.
JOB_INGEST_MATERIAL: Final = "ingest_material"
JOB_DELETE_MATERIAL_FILE: Final = "delete_material_file"

_PDF_SIGNATURE: Final = b"%PDF-"
_PDF_SIGNATURE_WINDOW: Final = 1024
_JPEG_SIGNATURE: Final = b"\xff\xd8\xff"
_PNG_SIGNATURE: Final = b"\x89PNG\r\n\x1a\n"
_BLANK_RUN: Final = re.compile(r"\n{3,}")


def sniff_mime(data: bytes) -> str | None:
    """The MIME type by file signature, or None when it is not a supported file."""
    # The exact offset-0 image signatures first: an image whose bytes happen to contain
    # "%PDF-" is still an image.
    if data.startswith(_PNG_SIGNATURE):
        return "image/png"
    if data.startswith(_JPEG_SIGNATURE):
        return "image/jpeg"
    if _PDF_SIGNATURE in data[:_PDF_SIGNATURE_WINDOW]:
        return PDF_MIME
    return None


def normalize_text(text: str) -> str:
    """Make extracted text safe to store as jsonb and tidy for reading.

    Postgres jsonb rejects NUL and lone surrogates, so both are removed.
    """
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    text = text.encode("utf-8", "ignore").decode("utf-8")
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    # A run of blank lines becomes a single blank line (the brief's test pins
    # "a  \n\n\n\nb" to "a\n\nb").
    text = _BLANK_RUN.sub("\n\n", text)
    return text.strip()


def visible_chars(text: str) -> int:
    return sum(1 for char in text if not char.isspace())


def is_scanned(text: str, *, max_chars: int) -> bool:
    """A page with this little text is treated as a scan (an image of a page)."""
    return visible_chars(text) <= max_chars


@dataclass(frozen=True)
class PageText:
    page: int  # 1-based
    text: str
    scanned: bool


@dataclass(frozen=True)
class ExtractedText:
    pages: tuple[PageText, ...]
    page_count: int  # the real count, even when pages was cut short
    warnings: tuple[str, ...]

    @property
    def scanned_pages(self) -> int:
        return sum(1 for page in self.pages if page.scanned)

    def to_json(self) -> list[dict[str, object]]:
        return [
            {"page": page.page, "text": page.text, "scanned": page.scanned} for page in self.pages
        ]


def image_as_pages() -> ExtractedText:
    """An uploaded image is one page with no text, so it counts as scanned."""
    return ExtractedText(
        pages=(PageText(page=1, text="", scanned=True),),
        page_count=1,
        warnings=(),
    )
