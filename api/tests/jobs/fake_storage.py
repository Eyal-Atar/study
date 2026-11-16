"""An in-memory `Storage` for worker tests; no network."""

from collections.abc import Sequence

from app.jobs.storage import FileMissing, FileTooLarge


class MemoryStorage:
    """Files in a dict, deletions recorded, and per-path exceptions to throw."""

    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}
        self.deleted: list[str] = []
        self.failures: dict[str, Exception] = {}
        # One list per delete_many call, in order.
        self.batches: list[list[str]] = []

    def download(self, path: str, *, max_bytes: int) -> bytes:
        if path in self.failures:
            raise self.failures[path]
        if path not in self.files:
            raise FileMissing(f"no such file: {path}")
        data = self.files[path]
        if len(data) > max_bytes:
            raise FileTooLarge(f"file over {max_bytes} bytes: {path}")
        return data

    def delete(self, path: str) -> None:
        if path in self.failures:
            raise self.failures[path]
        self.deleted.append(path)
        self.files.pop(path, None)

    def delete_many(self, paths: Sequence[str]) -> None:
        """All or nothing: a path in `failures` raises before anything is deleted."""
        for path in paths:
            if path in self.failures:
                raise self.failures[path]
        self.batches.append(list(paths))
        for path in paths:
            self.deleted.append(path)
            self.files.pop(path, None)
