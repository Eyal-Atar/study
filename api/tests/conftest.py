import base64
import json
import time
from collections.abc import Iterable
from typing import Any
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jwt.algorithms import ECAlgorithm

from app.config import Settings
from app.main import create_app
from tests.tokens import TEST_KID, USER_ID, StaticKeys, TokenFactory, add_auth_probe

pytest_plugins = ["tests.fixtures_db"]


def _b64url_json(data: dict[str, Any]) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()


@pytest.fixture
def settings() -> Settings:
    return Settings(supabase_url="https://test-ref.supabase.co", _env_file=None)


@pytest.fixture
def signing_key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


@pytest.fixture
def other_key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


@pytest.fixture
def jwks(signing_key: ec.EllipticCurvePrivateKey) -> dict[str, Any]:
    public_key = ECAlgorithm.to_jwk(signing_key.public_key(), as_dict=True)
    return {"keys": [{**public_key, "kid": TEST_KID, "alg": "ES256", "use": "sig"}]}


@pytest.fixture
def make_token(settings: Settings, signing_key: ec.EllipticCurvePrivateKey) -> TokenFactory:
    def make(
        *,
        drop: Iterable[str] = (),
        key: ec.EllipticCurvePrivateKey | str | None = None,
        kid: str = TEST_KID,
        algorithm: str = "ES256",
        **claims: Any,
    ) -> str:
        now = int(time.time())
        payload: dict[str, Any] = {
            "iss": settings.jwt_issuer,
            "aud": "authenticated",
            "role": "authenticated",
            "sub": str(USER_ID),
            "email": "student@example.com",
            "iat": now,
            "exp": now + 3600,
            "session_id": str(uuid4()),
            "aal": "aal1",
            "is_anonymous": False,
            **claims,
        }
        for name in drop:
            del payload[name]
        if algorithm == "none":
            header = {"alg": "none", "typ": "JWT", "kid": kid}
            return f"{_b64url_json(header)}.{_b64url_json(payload)}."
        return jwt.encode(
            payload,
            signing_key if key is None else key,
            algorithm=algorithm,
            headers={"kid": kid},
        )

    return make


@pytest.fixture
def app(settings: Settings, jwks: dict[str, Any]) -> FastAPI:
    return add_auth_probe(create_app(settings, signing_keys=StaticKeys(jwks)))


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)
