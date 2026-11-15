"""Jobs as the API reads them: the user's own, or not_found."""

from uuid import UUID

from app.errors import ApiError
from app.jobs.queue import JobRow, get_job
from app.services.profiles import Conn


def read_job(conn: Conn, user_id: UUID, job_id: UUID) -> JobRow:
    job = get_job(conn, user_id, job_id)
    if job is None:
        raise ApiError("not_found")
    return job
