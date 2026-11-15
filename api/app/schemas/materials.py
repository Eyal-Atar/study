import datetime as dt
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.domain.materials import MaterialKind
from app.schemas.text import NoNul

MaterialFilename = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255), NoNul
]


class MaterialRegister(BaseModel):
    """A file the client is about to upload; `id` is chosen by the client (it names the path)."""

    model_config = ConfigDict(extra="forbid")

    id: UUID
    filename: MaterialFilename
    kind: MaterialKind
    mime: Literal["application/pdf", "image/jpeg", "image/png"]
    size_bytes: Annotated[int, Field(ge=1)]


class MaterialOut(BaseModel):
    """A material as the web sees it: never the extracted text or the storage path."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    exam_id: UUID
    filename: str
    kind: MaterialKind
    mime: str
    size_bytes: int
    page_count: int | None
    scanned_pages: int | None
    ingest_status: str
    ingest_error: str | None
    warnings: list[str]
    created_at: dt.datetime
    ingested_at: dt.datetime | None


class MaterialRegisterResponse(BaseModel):
    material: MaterialOut
    job_id: UUID
