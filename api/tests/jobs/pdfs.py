"""A minimal PDF writer for tests: one Helvetica page per entry, ASCII text only."""

from collections.abc import Sequence
from typing import Final

GARBAGE_PDF: Final = b"%PDF-1.7\n" + b"\x00garbage" * 50


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _content_stream(text: str) -> bytes:
    if not text:
        return b""
    # One Tj per line, moving down 14 points each time.
    lines = text.split("\n")
    parts = ["BT /F1 12 Tf 72 720 Td 14 TL"]
    for index, line in enumerate(lines):
        if index:
            parts.append("T*")
        parts.append(f"({_escape(line)}) Tj")
    parts.append("ET")
    return " ".join(parts).encode("ascii")


def make_pdf(pages: Sequence[str]) -> bytes:
    """A valid PDF with one page per entry; an empty string gives an empty page."""
    count = len(pages)
    font_id = 3 + 2 * count
    kids = " ".join(f"{3 + 2 * i} 0 R" for i in range(count))
    bodies: dict[int, bytes] = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: f"<< /Type /Pages /Kids [{kids}] /Count {count} >>".encode("ascii"),
        font_id: (
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
        ),
    }
    for i, text in enumerate(pages):
        page_id = 3 + 2 * i
        stream = _content_stream(text)
        bodies[page_id] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 {font_id} 0 R >> >> "
            f"/Contents {page_id + 1} 0 R >>"
        ).encode("ascii")
        bodies[page_id + 1] = (
            f"<< /Length {len(stream)} >>\nstream\n".encode("ascii") + stream + b"\nendstream"
        )

    out = bytearray(b"%PDF-1.4\n")
    offsets: dict[int, int] = {}
    for obj_id in sorted(bodies):
        offsets[obj_id] = len(out)
        out += f"{obj_id} 0 obj\n".encode("ascii") + bodies[obj_id] + b"\nendobj\n"
    xref_at = len(out)
    size = font_id + 1
    out += f"xref\n0 {size}\n".encode("ascii")
    out += b"0000000000 65535 f \n"
    for obj_id in range(1, size):
        out += f"{offsets[obj_id]:010d} 00000 n \n".encode("ascii")
    out += f"trailer\n<< /Size {size} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n".encode("ascii")
    return bytes(out)
