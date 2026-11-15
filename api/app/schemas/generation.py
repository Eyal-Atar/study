from uuid import UUID

from pydantic import BaseModel


class GenerationResponse(BaseModel):
    """The job that builds the plan; created is false when an active one was returned."""

    job_id: UUID
    created: bool
