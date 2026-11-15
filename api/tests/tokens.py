from collections.abc import Callable, Mapping
from typing import Any
from uuid import UUID

import jwt
from fastapi import FastAPI

from app.auth import AuthenticatedUser

USER_ID = UUID("6f1c9a52-3d0e-4b8e-9a51-2c7f0e4d8b13")
TEST_KID = "test-key-1"

TokenFactory = Callable[..., str]


def add_auth_probe(app: FastAPI) -> FastAPI:
    """Mount GET /probe, an endpoint that needs a valid token and nothing else (no database)."""

    def probe(user: AuthenticatedUser) -> dict[str, str]:
        return {"id": str(user.id)}

    app.add_api_route("/probe", probe)
    return app


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class StaticKeys:
    """A SigningKeySource over a fixed JWKS: PyJWKClient's lookup without the network."""

    def __init__(self, jwks: Mapping[str, Any]) -> None:
        self._keys = jwt.PyJWKSet.from_dict(dict(jwks)).keys

    def get_signing_key_from_jwt(self, token: str) -> jwt.PyJWK:
        kid = jwt.get_unverified_header(token).get("kid")
        for key in self._keys:
            if key.key_id == kid:
                return key
        raise jwt.PyJWKClientError(f'Unable to find a signing key that matches: "{kid}"')
