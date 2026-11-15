import logging
from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import cast

import psycopg
import psycopg.errors
import psycopg_pool
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

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
        "database_unavailable": Problem(503, "השירות לא זמין כרגע. נסו שוב בעוד רגע."),
        "plan_conflict": Problem(409, "השינוי מתנגש בבלוק אחר בלוח. רעננו ונסו שוב."),
        "stale_plan": Problem(409, "התוכנית השתנתה בינתיים. רעננו ונסו שוב."),
        "placement_failed": Problem(409, "לא מצאנו מקום פנוי למשימה. אפשר לתכנן מחדש את הלוח."),
        "invalid_state": Problem(409, "אי אפשר לבצע את הפעולה הזו במצב הנוכחי."),
        "nothing_to_undo": Problem(409, "אין שינוי לבטל."),
        "dependency_cycle": Problem(422, "התלות הזו יוצרת מעגל בין משימות."),
        "exam_in_past": Problem(422, "תאריך המבחן כבר עבר."),
        "too_many_materials": Problem(422, "הגעתם למספר הקבצים המקסימלי למבחן הזה."),
        "file_too_large": Problem(422, "הקובץ גדול מדי."),
        "already_exists": Problem(409, "הפריט הזה כבר קיים."),
        "ai_quota_exceeded": Problem(429, "הגעתם למספר יצירות התוכנית היומי. אפשר לנסות שוב מחר."),
        "nothing_to_analyze": Problem(409, "כל המבחנים כבר נותחו. אפשר לתכנן מחדש את הלוח."),
        "internal_error": Problem(500, "משהו השתבש אצלנו. נסו שוב מאוחר יותר."),
    }
)

_HTTP_STATUS_CODES = {401: "unauthenticated", 404: "not_found", 405: "method_not_allowed"}


class ApiError(Exception):
    def __init__(
        self,
        code: str,
        *,
        headers: Mapping[str, str] | None = None,
        extra: Mapping[str, object] | None = None,
    ) -> None:
        PROBLEMS[code]  # deliberate KeyError: an unknown code must fail at construction
        super().__init__(code)
        self.code = code
        self.headers = dict(headers) if headers else None
        self.extra = dict(extra) if extra else None


def _problem_response(
    code: str,
    *,
    status: int | None = None,
    headers: Mapping[str, str] | None = None,
    errors: list[dict[str, object]] | None = None,
    extra: Mapping[str, object] | None = None,
) -> JSONResponse:
    problem = PROBLEMS[code]
    status = problem.status if status is None else status
    body: dict[str, object] = {
        **(extra or {}),
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
    return _problem_response(error.code, headers=error.headers, extra=error.extra)


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


async def _handle_plan_conflict(_: Request, __: Exception) -> JSONResponse:
    return _problem_response("plan_conflict")


async def _handle_database_unavailable(_: Request, exc: Exception) -> JSONResponse:
    # Only the class name: the message can carry connection details.
    logger.warning("Database unavailable: %s", type(exc).__name__)
    return _problem_response("database_unavailable")


class CatchAllMiddleware:
    """Turn an unhandled exception into the internal_error problem, inside CORSMiddleware.

    Starlette's own 500 handler runs outside the user middleware, so its response would
    carry no CORS headers and the browser would hide it from the web app.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = False

        async def tracking_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, tracking_send)
        except Exception:
            if started:
                raise
            logger.exception("Unhandled exception")
            response = _problem_response("internal_error")
            await response(scope, receive, send)


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, _handle_api_error)
    app.add_exception_handler(StarletteHTTPException, _handle_http_exception)
    app.add_exception_handler(RequestValidationError, _handle_validation_error)
    app.add_exception_handler(psycopg.errors.ExclusionViolation, _handle_plan_conflict)
    for unavailable in (
        psycopg_pool.PoolTimeout,
        psycopg.OperationalError,
        psycopg.errors.QueryCanceled,
    ):
        app.add_exception_handler(unavailable, _handle_database_unavailable)
    app.add_exception_handler(Exception, _handle_unexpected)
