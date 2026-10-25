import logging
from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import cast

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)

PROBLEM_JSON = "application/problem+json"


@dataclass(frozen=True)
class Problem:
    status: int
    title: str


PROBLEMS: Mapping[str, Problem] = MappingProxyType(
    {
        "unauthenticated": Problem(401, "צריך להתחבר מחדש."),
        "auth_unavailable": Problem(503, "שירות ההתחברות לא זמין כרגע. נסו שוב בעוד רגע."),
        "not_found": Problem(404, "לא מצאנו את מה שחיפשת."),
        "method_not_allowed": Problem(405, "אי אפשר לבצע את הפעולה הזו כאן."),
        "validation_error": Problem(422, "חלק מהפרטים שנשלחו לא תקינים."),
        "bad_request": Problem(400, "הבקשה לא תקינה."),
        "internal_error": Problem(500, "משהו השתבש אצלנו. נסו שוב מאוחר יותר."),
    }
)

_HTTP_STATUS_CODES = {401: "unauthenticated", 404: "not_found", 405: "method_not_allowed"}


class ApiError(Exception):
    def __init__(self, code: str, *, headers: Mapping[str, str] | None = None) -> None:
        PROBLEMS[code]  # deliberate KeyError: an unknown code must fail at construction
        super().__init__(code)
        self.code = code
        self.headers = dict(headers) if headers else None


def _problem_response(
    code: str,
    *,
    status: int | None = None,
    headers: Mapping[str, str] | None = None,
    errors: list[dict[str, object]] | None = None,
) -> JSONResponse:
    problem = PROBLEMS[code]
    status = problem.status if status is None else status
    body: dict[str, object] = {
        "type": "about:blank",
        "title": problem.title,
        "status": status,
        "code": code,
    }
    if errors is not None:
        body["errors"] = errors
    return JSONResponse(
        body,
        status_code=status,
        headers=dict(headers) if headers else None,
        media_type=PROBLEM_JSON,
    )


async def _handle_api_error(_: Request, exc: Exception) -> JSONResponse:
    error = cast(ApiError, exc)
    return _problem_response(error.code, headers=error.headers)


async def _handle_http_exception(_: Request, exc: Exception) -> JSONResponse:
    error = cast(StarletteHTTPException, exc)
    headers = dict(error.headers) if error.headers else None
    if error.status_code in _HTTP_STATUS_CODES:
        return _problem_response(_HTTP_STATUS_CODES[error.status_code], headers=headers)
    if 400 <= error.status_code < 500:
        return _problem_response("bad_request", status=error.status_code, headers=headers)
    return _problem_response("internal_error", headers=headers)


async def _handle_validation_error(_: Request, exc: Exception) -> JSONResponse:
    error = cast(RequestValidationError, exc)
    errors: list[dict[str, object]] = [
        {"loc": list(item["loc"]), "type": item["type"]} for item in error.errors()
    ]
    return _problem_response("validation_error", errors=errors)


async def _handle_unexpected(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception", exc_info=exc)
    return _problem_response("internal_error")


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, _handle_api_error)
    app.add_exception_handler(StarletteHTTPException, _handle_http_exception)
    app.add_exception_handler(RequestValidationError, _handle_validation_error)
    app.add_exception_handler(Exception, _handle_unexpected)
