import json
import time
from collections.abc import Callable
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric.ec import EllipticCurvePrivateKey
from fastapi.testclient import TestClient
from jwt.algorithms import HMACAlgorithm

from app.auth import TokenVerifier
from app.config import Settings
from app.main import create_app
from tests.tokens import TEST_KID, USER_ID, StaticKeys, TokenFactory, bearer

# Each case builds its token from (make_token, other_key, now).
REJECTED_TOKENS: dict[str, Callable[[TokenFactory, EllipticCurvePrivateKey, int], str]] = {
    "expired": lambda make, other, now: make(iat=now - 4000, exp=now - 60),
    "wrong-audience": lambda make, other, now: make(aud="anon"),
    "wrong-issuer": lambda make, other, now: make(iss="https://other-ref.supabase.co/auth/v1"),
    "anon-role": lambda make, other, now: make(role="anon"),
    "service-role": lambda make, other, now: make(role="service_role"),
    "anonymous-user": lambda make, other, now: make(is_anonymous=True),
    "sub-not-uuid": lambda make, other, now: make(sub="not-a-uuid"),
    "no-sub": lambda make, other, now: make(drop=("sub",)),
    "no-exp": lambda make, other, now: make(drop=("exp",)),
    "no-iat": lambda make, other, now: make(drop=("iat",)),
    "unknown-kid": lambda make, other, now: make(key=other, kid="other-key"),
    "wrong-key-same-kid": lambda make, other, now: make(key=other),
    "hs256": lambda make, other, now: make(key="x" * 32, algorithm="HS256"),
    "alg-none": lambda make, other, now: make(algorithm="none"),
    "garbage": lambda make, other, now: "not-a-jwt",
}


@pytest.mark.parametrize("build", REJECTED_TOKENS.values(), ids=REJECTED_TOKENS.keys())
def test_rejected_tokens_get_401(
    client: TestClient,
    make_token: TokenFactory,
    other_key: EllipticCurvePrivateKey,
    build: Callable[[TokenFactory, EllipticCurvePrivateKey, int], str],
) -> None:
    token = build(make_token, other_key, int(time.time()))
    response = client.get("/me", headers=bearer(token))
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json()["code"] == "unauthenticated"


def test_jwks_key_outside_the_allowed_algorithms_is_401(
    settings: Settings, make_token: TokenFactory
) -> None:
    # A symmetric key in the JWKS would be public, so anyone could sign with it.
    secret = "x" * 32
    hmac_key = HMACAlgorithm.to_jwk(secret, as_dict=True)
    jwks = {"keys": [{**hmac_key, "kid": TEST_KID, "alg": "HS256", "use": "sig"}]}
    client = TestClient(create_app(settings, signing_keys=StaticKeys(jwks)))
    response = client.get("/me", headers=bearer(make_token(key=secret, algorithm="HS256")))
    assert response.status_code == 401
    assert response.json()["code"] == "unauthenticated"


def test_clock_skew_within_30_seconds_is_accepted(
    client: TestClient, make_token: TokenFactory
) -> None:
    now = int(time.time())
    assert client.get("/probe", headers=bearer(make_token(iat=now + 5))).status_code == 200
    assert (
        client.get("/probe", headers=bearer(make_token(iat=now - 3600, exp=now - 5))).status_code
        == 200
    )


def test_audience_may_be_a_list(client: TestClient, make_token: TokenFactory) -> None:
    assert (
        client.get("/probe", headers=bearer(make_token(aud=["authenticated"]))).status_code == 200
    )


def test_unreachable_jwks_is_503(make_token: TokenFactory) -> None:
    settings = Settings(supabase_url="http://127.0.0.1:9", _env_file=None)  # nothing listens there
    response = TestClient(create_app(settings)).get("/me", headers=bearer(make_token()))
    assert response.status_code == 503
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json()["code"] == "auth_unavailable"


class BrokenKeys:
    """A SigningKeySource whose JWKS lookup always fails with the given error."""

    def __init__(self, error: Exception) -> None:
        self.error = error

    def get_signing_key_from_jwt(self, token: str) -> jwt.PyJWK:
        raise self.error


@pytest.mark.parametrize(
    "error",
    [
        json.JSONDecodeError("Expecting value", "<html>", 0),
        ConnectionResetError(),
        jwt.PyJWKSetError("The JWK Set did not contain any keys"),
        UnicodeDecodeError("utf-8", b"\x80", 0, 1, "invalid start byte"),
    ],
    ids=["not-json", "connection-reset", "empty-key-set", "non-utf8-body"],
)
def test_broken_jwks_is_503(settings: Settings, make_token: TokenFactory, error: Exception) -> None:
    client = TestClient(create_app(settings, signing_keys=BrokenKeys(error)))
    response = client.get("/me", headers=bearer(make_token()))
    assert response.status_code == 503
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json()["code"] == "auth_unavailable"


def test_verifier_keeps_the_claims_read_only(
    settings: Settings, jwks: dict[str, Any], make_token: TokenFactory
) -> None:
    user = TokenVerifier(StaticKeys(jwks), issuer=settings.jwt_issuer).verify(
        make_token(session_id="s-1")
    )
    assert user.id == USER_ID
    assert user.claims["session_id"] == "s-1"
    with pytest.raises(TypeError):
        user.claims["role"] = "service_role"  # type: ignore[index]
