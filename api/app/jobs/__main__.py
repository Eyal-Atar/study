"""The worker process: `python -m app.jobs`, run from api/.

It reads the same settings as the API plus WORKER_DATABASE_URL (the schema owner) and
SUPABASE_SECRET_KEY (for Storage, and for the Auth admin API that deletes accounts; the
worker's default factory builds that client from the same settings), and runs jobs until
SIGINT or SIGTERM. When VAPID is configured it also runs the reminder ticker in a thread of
its own (see notifications.py), which stops on the same signal and is joined before the
process exits.
"""

import logging
import signal
import threading
from types import FrameType

from app.config import Settings
from app.jobs.ingest import HANDLERS, ON_CRASHED
from app.jobs.notifications import NotificationTicker
from app.jobs.storage import SupabaseStorage
from app.jobs.webpush import WebPushSender
from app.jobs.worker import Worker

logger = logging.getLogger("app.jobs")


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    # httpx2 logs every request URL at INFO, and Storage URLs carry the file's path.
    logging.getLogger("httpx2").setLevel(logging.WARNING)
    settings = Settings()
    if settings.worker_database_url is None or settings.supabase_secret_key is None:
        raise SystemExit("WORKER_DATABASE_URL and SUPABASE_SECRET_KEY are required")

    storage = SupabaseStorage(
        str(settings.supabase_url), settings.supabase_secret_key.get_secret_value()
    )
    worker = Worker(
        settings.worker_database_url,
        storage=storage,
        settings=settings,
        handlers=HANDLERS,
        on_crashed=ON_CRASHED,
    )
    stop = threading.Event()

    def request_stop(signum: int, frame: FrameType | None) -> None:
        stop.set()

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    sender: WebPushSender | None = None
    ticker_thread: threading.Thread | None = None
    if (
        settings.push_configured
        and settings.vapid_private_key is not None
        and settings.vapid_public_key is not None
        and settings.vapid_subject is not None
    ):
        sender = WebPushSender(
            settings.vapid_private_key.get_secret_value(),
            settings.vapid_public_key,
            settings.vapid_subject,
            timeout=settings.push_timeout_seconds,
        )
        ticker = NotificationTicker(settings.worker_database_url, sender, settings, stop=stop)
        # Not a daemon: on shutdown it finishes its round (and closes its connection) first.
        ticker_thread = threading.Thread(target=ticker.run, name="reminders")
        ticker_thread.start()
    else:
        logger.warning("push not configured; reminders are off")
    try:
        worker.run_forever(stop=stop)
    finally:
        # run_forever may also end by an exception; the ticker must stop either way.
        stop.set()
        if ticker_thread is not None:
            ticker_thread.join()
        if sender is not None:
            sender.close()
        worker.close()
        storage.close()


if __name__ == "__main__":
    main()
