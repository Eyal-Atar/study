"""Text rules shared by the request schemas."""

from pydantic import AfterValidator


def _no_nul(value: str) -> str:
    # Postgres text cannot hold U+0000: let it fail as a 422, not in the database.
    if "\x00" in value:
        raise ValueError("must not contain a NUL character")
    return value


NoNul = AfterValidator(_no_nul)
