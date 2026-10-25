import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.errors import PROBLEMS, ApiError


def _unavailable() -> None:
    raise ApiError("auth_unavailable")


def _boom() -> None:
    raise RuntimeError("database password is hunter2")


def _probe(number: int) -> dict[str, int]:
    return {"number": number}


def test_unknown_route_is_problem_json(client: TestClient) -> None:
    response = client.get("/no-such-route")
    assert response.status_code == 404
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json() == {
        "type": "about:blank",
        "title": "לא מצאנו את מה שחיפשת.",
        "status": 404,
        "code": "not_found",
    }


def test_wrong_method_is_405_with_allow_header(client: TestClient) -> None:
    response = client.post("/health")
    assert response.status_code == 405
    assert response.json()["code"] == "method_not_allowed"
    assert "GET" in response.headers["allow"]


def test_validation_error_names_fields_without_echoing_input(app: FastAPI) -> None:
    app.add_api_route("/probe/{number}", _probe)
    response = TestClient(app).get("/probe/secret-input")
    assert response.status_code == 422
    assert response.json()["errors"] == [{"loc": ["path", "number"], "type": "int_parsing"}]
    assert "secret-input" not in response.text


def test_api_error_uses_the_catalog(app: FastAPI) -> None:
    app.add_api_route("/unavailable", _unavailable)
    response = TestClient(app).get("/unavailable")
    assert response.status_code == 503
    assert response.json()["title"] == PROBLEMS["auth_unavailable"].title


def test_unhandled_exception_hides_details(app: FastAPI) -> None:
    app.add_api_route("/boom", _boom)
    response = TestClient(app, raise_server_exceptions=False).get("/boom")
    assert response.status_code == 500
    assert response.json()["code"] == "internal_error"
    assert "hunter2" not in response.text


def test_every_title_is_hebrew() -> None:
    hebrew = re.compile("[֐-׿]")
    assert [code for code, problem in PROBLEMS.items() if not hebrew.search(problem.title)] == []


def test_unknown_code_raises_key_error() -> None:
    with pytest.raises(KeyError):
        ApiError("no_such_code")
