import pytest

from app.domain.materials import ExtractedText
from app.jobs.pdf_text import PdfUnreadable, extract_pdf, pdf_subset
from tests.jobs.pdfs import GARBAGE_PDF, make_pdf


def _extract(data: bytes) -> ExtractedText:
    return extract_pdf(data, max_pages=50, scanned_max_chars=5, max_chars_per_page=1000)


def test_subset_keeps_the_requested_pages_in_order() -> None:
    data = make_pdf(["a", "", "c", ""])
    result = _extract(pdf_subset(data, [2, 4]))
    assert result.page_count == 2
    assert all(page.scanned for page in result.pages)
    reordered = _extract(pdf_subset(make_pdf(["first page", "second page"]), [2, 1]))
    assert [p.text for p in reordered.pages] == ["second page", "first page"]


def test_page_outside_the_document_is_unreadable() -> None:
    with pytest.raises(PdfUnreadable):
        pdf_subset(make_pdf(["a", "", "c", ""]), [5])
    with pytest.raises(PdfUnreadable):
        pdf_subset(make_pdf(["a"]), [0])


def test_garbage_is_unreadable() -> None:
    with pytest.raises(PdfUnreadable):
        pdf_subset(GARBAGE_PDF, [1])
