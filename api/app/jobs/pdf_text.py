"""Text extraction from PDFs with pypdfium2.

PDFium is not thread-safe: the worker runs this single-threaded, one file at a time.
Error messages never include text from the file.
"""

import pypdfium2 as pdfium

from app.domain.materials import (
    WARNING_PAGES_TRUNCATED,
    WARNING_TEXT_TRUNCATED,
    ExtractedText,
    PageText,
    is_scanned,
    normalize_text,
)


class PdfUnreadable(Exception):
    """The file is not a PDF that PDFium can open (garbage, damaged or password-protected)."""


def _page_text(pdf: pdfium.PdfDocument, index: int) -> str:
    page = pdf[index]
    try:
        textpage = page.get_textpage()
        try:
            return str(textpage.get_text_range())
        finally:
            textpage.close()
    finally:
        page.close()


def extract_pdf(
    data: bytes,
    *,
    max_pages: int,
    scanned_max_chars: int,
    max_chars_per_page: int,
) -> ExtractedText:
    try:
        pdf = pdfium.PdfDocument(data)
    except pdfium.PdfiumError as exc:
        raise PdfUnreadable("The PDF could not be opened") from exc
    try:
        page_count = len(pdf)
        warnings: list[str] = []
        pages: list[PageText] = []
        for index in range(min(page_count, max_pages)):
            try:
                text = normalize_text(_page_text(pdf, index))
            except pdfium.PdfiumError as exc:
                raise PdfUnreadable(f"Page {index + 1} could not be read") from exc
            if len(text) > max_chars_per_page:
                text = text[:max_chars_per_page]
                if WARNING_TEXT_TRUNCATED not in warnings:
                    warnings.append(WARNING_TEXT_TRUNCATED)
            pages.append(
                PageText(
                    page=index + 1,
                    text=text,
                    scanned=is_scanned(text, max_chars=scanned_max_chars),
                )
            )
        if page_count > max_pages:
            warnings.append(WARNING_PAGES_TRUNCATED)
        return ExtractedText(pages=tuple(pages), page_count=page_count, warnings=tuple(warnings))
    finally:
        pdf.close()
