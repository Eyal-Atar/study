"""Verify Supabase access tokens locally against the project's JWKS."""

import json
import logging
from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Annotated, Any, Protocol
from uuid import UUID

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import Settings
from app.errors import ApiError

logger = logging.getLogger(__name__)

JWT_AUDIENCE = "authenticated"
ALLOWED_ALGORITHMS = frozenset({"ES256", "RS256"})
CLOCK_SKEW_SECONDS = 30
JWKS_CACHE_SECONDS = 600  # as long as Supabase's own JWKS cache
JWKS_TIMEOUT_SECONDS = 5.0

_CHALLENGE: Mapping[str, str] = MappingProxyType({"WWW-Authenticate": "Bearer"})

# Failures of the JWKS itself, as opposed to the token. PyJWKClient wraps only some
# network errors, so a non-JSON body or a reset mid-read arrive unwrapped.
# JSONDecodeError and not ValueError, so a malformed token can never become a 503.
_JWKS_FAILURES = (
    jwt.PyJWKClientConnectionError,
    jwt.PyJWKSetError,
    OSError,
    json.JSONDecodeError,
)


@dataclass(frozen=True)
class CurrentUser:
    id: UUID
    email: str | None
    claims: Mapping[str, Any]


class SigningKeySource(Protocol):
    def get_signing_key_from_jwt(self, token: str) -> jwt.PyJWK: ...


def _rejected(reason: str) -> ApiError:
    # Only the reason goes to the log, never the token or its claims.
    logger.warning("Rejected access token: %s", reason)
    return ApiError("unauthenticated", headers=_CHALLENGE)


class TokenVerifier:
    def __init__(self, keys: SigningKeySource, *, issuer: str) -> None:
        self.keys = keys
        self.issuer = issuer

    def verify(self, token: str) -> CurrentUser:
        try:
            key = self.keys.get_signing_key_from_jwt(token)
        except _JWKS_FAILURES as exc:
            logger.warning("JWKS unavailable: %s", type(exc).__name__)
            raise ApiError("auth_unavailable") from exc
        except jwt.PyJWTError as exc:
            raise _rejected(type(exc).__name__) from exc

        if key.algorithm_name not in ALLOWED_ALGORITHMS:
            raise _rejected("DisallowedKeyAlgorithm")

        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=[key.algorithm_name],
                audience=JWT_AUDIENCE,
                issuer=self.issuer,
                leeway=CLOCK_SKEW_SECONDS,
                options={"require": ["exp", "iat", "sub", "aud", "iss"]},
            )
        except jwt.PyJWTError as exc:
            raise _rejected(type(exc).__name__) from exc

        if claims.get("role") != "authenticated":
            raise _rejected("NotAuthenticatedRole")
        if claims.get("is_anonymous") is True:
            raise _rejected("AnonymousUser")

        try:
            user_id = UUID(claims["sub"])  # PyJWT already checked that sub is a string
        except ValueError as exc:
            raise _rejected("SubjectNotUUID") from exc

        email = claims.get("email")
        return CurrentUser(
            id=user_id,
            email=email if isinstance(email, str) and email else None,
            claims=MappingProxyType(claims),
        )


def jwks_client(settings: Settings) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(
        settings.jwks_url,
        cache_jwk_set=True,
        lifespan=JWKS_CACHE_SECONDS,
        timeout=JWKS_TIMEOUT_SECONDS,
    )


bearer_scheme = HTTPBearer(auto_error=False)


# A plain def on purpose: PyJWKClient fetches the JWKS with blocking urllib, and
# FastAPI runs sync dependencies in its thread pool, off the event loop.
def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> CurrentUser:
    if credentials is None:
        raise ApiError("unauthenticated", headers=_CHALLENGE)
    verifier: TokenVerifier = request.app.state.token_verifier
    return verifier.verify(credentials.credentials)


AuthenticatedUser = Annotated[CurrentUser, Depends(get_current_user)]
