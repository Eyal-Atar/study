"""The delete_account job (S15): delete the user's files in Storage, then the user in Auth.

DELETE /me already deleted every app row of the user and queued this job in the same
transaction. The files are found in storage.objects (bucket `materials`, first folder = the
user), not in app.materials, which is gone. Files first, then Auth: deleting the Auth user
cascades to this job's own row, so nothing can be retried after it.

Each step is idempotent: a retry lists only the files still there, and Auth answers 404
for a user already deleted. Storage or Auth unavailable → retry with backoff.

Defence in depth: a name that does not lie inside the user's own folder (or has a ".." or
an empty segment) is skipped and never deleted; the job logs their count at ERROR and goes
on with the safe names and the Auth user, so one odd name cannot keep an account alive.
Nothing here logs file names.

The job gets 10 attempts (the worker raises the row's max_attempts, see worker.py), and its
final failure is logged at ERROR by the worker, to be alerted on.
"""

import logging
from collections.abc import Mapping
from typing import Any

from app.jobs.auth_admin import AuthUnavailable
from app.jobs.storage import MATERIALS_BUCKET, StorageUnavailable
from app.jobs.worker import JobContext, JobFailed

logger = logging.getLogger(__name__)


def _inside_folder(name: str, folder: str) -> bool:
    segments = name.split("/")
    return name.startswith(f"{folder}/") and ".." not in segments and "" not in segments[1:]


def delete_account(ctx: JobContext) -> Mapping[str, Any]:
    folder = str(ctx.job.user_id)
    listed = ctx.user_storage_names(MATERIALS_BUCKET)
    names = [name for name in listed if _inside_folder(name, folder)]
    if skipped := len(listed) - len(names):
        logger.error(
            "job %s: skipped %d storage names outside the user's folder", ctx.job.id, skipped
        )
    if names:
        try:
            ctx.storage.delete_many(names)
        except StorageUnavailable:
            raise JobFailed("storage_unavailable", retry=True) from None
    try:
        ctx.auth_admin().delete_user(ctx.job.user_id)
    except AuthUnavailable:
        raise JobFailed("auth_unavailable", retry=True) from None
    # Nothing back: on success the row is already gone with the user.
    return {}
