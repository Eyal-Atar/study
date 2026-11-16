"""The delete_account job (S15): delete the user's files in Storage, then the user in Auth.

DELETE /me already deleted every app row of the user and queued this job in the same
transaction. The files are found in storage.objects (bucket `materials`, first folder = the
user), not in app.materials, which is gone. Files first, then Auth: deleting the Auth user
cascades to this job's own row, so nothing can be retried after it.

Each step is idempotent: a retry lists only the files still there, and Auth answers 404
for a user already deleted. Storage or Auth unavailable → retry with backoff.

Defence in depth: every name must lie inside the user's own folder, with no ".." segment,
or the job fails at once (`unsafe_storage_path`, no retry) before deleting anything.
Nothing here logs file names.
"""

import logging
from collections.abc import Mapping
from typing import Any, Final

from app.jobs.auth_admin import AuthUnavailable
from app.jobs.storage import MATERIALS_BUCKET, StorageUnavailable
from app.jobs.worker import JobContext, JobFailed

logger = logging.getLogger(__name__)

UNSAFE_STORAGE_PATH: Final = "unsafe_storage_path"


def _inside_folder(name: str, folder: str) -> bool:
    segments = name.split("/")
    return name.startswith(f"{folder}/") and ".." not in segments and "" not in segments[1:]


def delete_account(ctx: JobContext) -> Mapping[str, Any]:
    folder = str(ctx.job.user_id)
    names = ctx.user_storage_names(MATERIALS_BUCKET)
    unsafe = sum(1 for name in names if not _inside_folder(name, folder))
    if unsafe:
        logger.warning("job %s: %d storage names outside the user's folder", ctx.job.id, unsafe)
        raise JobFailed(UNSAFE_STORAGE_PATH)
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
