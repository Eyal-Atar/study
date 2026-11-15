"""The real jwt.PyJWKClient against a local JWKS server (no StaticKeys)."""

import json
import threading
import time
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi.testclient import TestClient
from jwt.algorithms import ECAlgorithm, RSAAlgorithm

from app.config import Settings
from app.main import create_app
from tests.tokens import USER_ID, add_auth_probe, bearer

JWKS_PATH = "/auth/v1/.well-known/jwks.json"


@pytest.fixture
def jwks_server() -> Iterator[tuple[Settings, dict[str, Any]]]:
    served: dict[str, Any] = {"keys": []}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.path != JWKS_PATH:
                self.send_error(404)
                return
            body = json.dumps(served).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: Any) -> None:
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        settings = Settings(supabase_url=f"http://127.0.0.1:{server.server_port}", _env_file=None)
        yield settings, served
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def _token(settings: Settings, key: Any, kid: str, algorithm: str) -> str:
    now = int(time.time())
    claims = {
        "iss": settings.jwt_issuer,
        "aud": "authenticated",
        "role": "authenticated",
        "sub": str(USER_ID),
        "email": "student@example.com",
        "iat": now,
        "exp": now + 3600,
    }
    return jwt.encode(claims, key, algorithm=algorithm, headers={"kid": kid})


def test_real_client_verifies_an_es256_token(
    jwks_server: tuple[Settings, dict[str, Any]],
) -> None:
    settings, served = jwks_server
    key = ec.generate_private_key(ec.SECP256R1())
    public = ECAlgorithm.to_jwk(key.public_key(), as_dict=True)
    served["keys"] = [{**public, "kid": "es-1", "alg": "ES256", "use": "sig"}]
    client = TestClient(add_auth_probe(create_app(settings)))
    response = client.get("/probe", headers=bearer(_token(settings, key, "es-1", "ES256")))
    assert response.status_code == 200
    assert response.json()["id"] == str(USER_ID)


def test_real_client_verifies_an_rs256_token(
    jwks_server: tuple[Settings, dict[str, Any]],
) -> None:
    settings, served = jwks_server
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = RSAAlgorithm.to_jwk(key.public_key(), as_dict=True)
    served["keys"] = [{**public, "kid": "rs-1", "alg": "RS256", "use": "sig"}]
    client = TestClient(add_auth_probe(create_app(settings)))
    response = client.get("/probe", headers=bearer(_token(settings, key, "rs-1", "RS256")))
    assert response.status_code == 200
    assert response.json()["id"] == str(USER_ID)
