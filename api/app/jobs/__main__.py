"""The worker process: `python -m app.jobs`, run from api/.

It reads the same settings as the API plus WORKER_DATABASE_URL (the schema owner) and
SUPABASE_SECRET_KEY (for Storage), and runs jobs until SIGINT or SIGTERM.
"""

import logging
import signal
import threading
from types import FrameType

from app.config import Settings
from app.jobs.ingest import HANDLERS
from app.jobs.storage import SupabaseStorage
from app.jobs.worker import Worker


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    settings = Settings()
    if settings.worker_database_url is None or settings.supabase_secret_key is None:
        raise SystemExit("WORKER_DATABASE_URL and SUPABASE_SECRET_KEY are required")

    storage = SupabaseStorage(
        str(settings.supabase_url), settings.supabase_secret_key.get_secret_value()
    )
    worker = Worker(
        settings.worker_database_url, storage=storage, settings=settings, handlers=HANDLERS
    )
    stop = threading.Event()

    def request_stop(signum: int, frame: FrameType | None) -> None:
        stop.set()

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)
    try:
        worker.run_forever(stop=stop)
    finally:
        worker.close()
        storage.close()


if __name__ == "__main__":
    main()
