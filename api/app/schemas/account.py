from uuid import UUID

from pydantic import BaseModel


class DeleteAccountResponse(BaseModel):
    """The delete_account job: the worker deletes the files and the Auth user."""

    job_id: UUID
