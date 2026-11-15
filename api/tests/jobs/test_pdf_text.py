import pytest

from app.domain.materials import ExtractedText
from app.jobs.pdf_text import PdfUnreadable, extract_pdf
from tests.jobs.pdfs import GARBAGE_PDF, make_pdf

_THREE = make_pdf(
    [
        "First page with enough visible text to pass the threshold easily.",
        "",
        "Third page also has enough visible characters in it.",
    ]
)


def _extract(
    data: bytes, *, max_pages: int = 100, max_chars_per_page: int = 10_000
) -> ExtractedText:
    return extract_pdf(
        data,
        max_pages=max_pages,
        scanned_max_chars=20,
        max_chars_per_page=max_chars_per_page,
    )


def test_extracts_text_per_page_and_marks_blank_pages_scanned() -> None:
    result = _extract(_THREE)
    assert len(result.pages) == 3
    assert "First page" in result.pages[0].text
    assert result.pages[1].scanned is True
    assert result.pages[2].scanned is False
    assert result.page_count == 3
    assert result.warnings == ()


def test_truncates_pages_with_a_warning() -> None:
    result = _extract(_THREE, max_pages=1)
    assert len(result.pages) == 1
    assert result.page_count == 3
    assert result.warnings == ("pages_truncated",)


def test_truncates_long_pages_with_a_warning() -> None:
    result = _extract(_THREE, max_chars_per_page=10)
    assert len(result.pages[0].text) == 10
    assert len(result.pages[2].text) == 10
    assert result.warnings.count("text_truncated") == 1


@pytest.mark.parametrize("data", [GARBAGE_PDF, b""])
def test_garbage_is_unreadable(data: bytes) -> None:
    with pytest.raises(PdfUnreadable):
        _extract(data)


def test_zero_pages_is_ready_with_nothing() -> None:
    try:
        data = make_pdf([])
        result = _extract(data)
    except PdfUnreadable:
        pytest.skip("PDFium does not accept a PDF with zero pages")
    assert result.page_count == 0
    assert result.pages == ()
