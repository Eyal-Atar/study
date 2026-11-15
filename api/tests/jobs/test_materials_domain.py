import pytest

from app.domain.materials import (
    ExtractedText,
    PageText,
    image_as_pages,
    is_scanned,
    normalize_text,
    sniff_mime,
)
from tests.jobs.pdfs import make_pdf

_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        (make_pdf(["hello"]), "application/pdf"),
        (b"junk" * 100 + b"%PDF-1.4", "application/pdf"),
        (b"\xff\xd8\xff\xe0" + b"\x00" * 8, "image/jpeg"),
        (_PNG, "image/png"),
        (_PNG + b"%PDF-1.4", "image/png"),
        (b"PK\x03\x04", None),
        (b"", None),
    ],
)
def test_sniff_mime(data: bytes, expected: str | None) -> None:
    assert sniff_mime(data) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("a\r\nb\rc", "a\nb\nc"),
        ("a\x00b", "ab"),
        ("a\ud800b", "ab"),
        ("a  \n\n\n\nb", "a\n\nb"),
        ("  x  ", "x"),
    ],
)
def test_normalize_text(raw: str, expected: str) -> None:
    assert normalize_text(raw) == expected


def test_is_scanned_threshold() -> None:
    assert is_scanned(" ".join("x" * 40), max_chars=40) is True
    assert is_scanned(" ".join("x" * 41), max_chars=40) is False
    assert is_scanned("", max_chars=40) is True


def test_extracted_text_json_and_counts() -> None:
    extracted = ExtractedText(
        pages=(
            PageText(page=1, text="one", scanned=False),
            PageText(page=2, text="", scanned=True),
            PageText(page=3, text="three", scanned=False),
        ),
        page_count=3,
        warnings=(),
    )
    assert extracted.scanned_pages == 1
    as_json = extracted.to_json()
    assert as_json[1] == {"page": 2, "text": "", "scanned": True}
    assert all(set(item) == {"page", "text", "scanned"} for item in as_json)


def test_image_as_pages() -> None:
    extracted = image_as_pages()
    assert extracted.pages == (PageText(page=1, text="", scanned=True),)
    assert extracted.page_count == 1
    assert extracted.warnings == ()
