"""Who is asking (DECISIONS.md #32).

Cloudflare Access sits in front of both tiers and does the logging in; this
module's only job is to turn its assertion into a `users` row. The JWT is the
security boundary — the bare `Cf-Access-Authenticated-User-Email` header is
never read, because anything that can reach the origin can set it.

Two modes, and `access_aud` is the switch:

- **audience configured** — every request must carry a JWT that verifies
  against the team's published keys, the configured audience and the team
  issuer. Anything else is a 403. There is no fall back to the dev identity
  from here; that is the whole point of making one setting decide.
- **no audience** — the app runs as `dev_user_email`. Local `uvicorn
  --reload`, pytest and the Playwright suite have no Access in front of them
  and would otherwise be unable to make a single request.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx
import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .config import Settings, settings
from .database import get_session
from .models import User

# Access publishes RS256 only. Pinned rather than read from the token's own
# header, which is the classic algorithm-confusion hole.
ALGORITHMS = ["RS256"]

JWT_HEADER = "Cf-Access-Jwt-Assertion"
# Access sets this cookie on the browser as well as the header on the proxied
# request. Read as a fallback so a direct hit on the tunnel hostname (no
# header rewriting) still authenticates.
JWT_COOKIE = "CF_Authorization"

# Keys are cached for this long, and a token naming a key we don't have
# triggers at most one refetch per this many seconds. Both bounds exist for
# the same reason: an attacker who can send arbitrary `kid` values must not
# be able to turn that into unbounded outbound requests.
JWKS_TTL_SECONDS = 15 * 60
JWKS_MIN_REFETCH_SECONDS = 60


def team_urls(team_domain: str) -> tuple[str, str]:
    """(issuer, jwks_url) for a team domain, with or without a scheme."""
    host = team_domain.removeprefix("https://").removeprefix("http://").strip("/")
    issuer = f"https://{host}"
    return issuer, f"{issuer}/cdn-cgi/access/certs"


class _JwksCache:
    """Fetched keys, with the two bounds above. One instance per process."""

    def __init__(self) -> None:
        self._keys: dict[str, jwt.PyJWK] = {}
        self._fetched_at: float | None = None
        self._lock = asyncio.Lock()

    async def key_for(self, kid: str, jwks_url: str) -> jwt.PyJWK:
        key = self._keys.get(kid)
        if key is not None and not self._stale():
            return key
        async with self._lock:
            # Another waiter may have refreshed while we queued.
            key = self._keys.get(kid)
            if key is not None and not self._stale():
                return key
            if self._may_refetch():
                await self._fetch(jwks_url)
            key = self._keys.get(kid)
        if key is None:
            raise HTTPException(403, "Access token names an unknown signing key")
        return key

    def _stale(self) -> bool:
        return (
            self._fetched_at is None
            or time.monotonic() - self._fetched_at > JWKS_TTL_SECONDS
        )

    def _may_refetch(self) -> bool:
        return (
            self._fetched_at is None
            or time.monotonic() - self._fetched_at > JWKS_MIN_REFETCH_SECONDS
        )

    async def _fetch(self, jwks_url: str) -> None:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(jwks_url)
                response.raise_for_status()
                key_set = jwt.PyJWKSet.from_dict(response.json())
        except (httpx.HTTPError, ValueError, jwt.PyJWTError) as e:
            # Keep whatever we already had: a key that verified a minute ago
            # still verifies, and a blip in Cloudflare's cert endpoint should
            # not log the whole app out. With nothing cached there is no
            # verifying anything, and that is an outage, not a bad token —
            # 503 so it doesn't read as "your login expired".
            if not self._keys:
                raise HTTPException(503, "cannot reach Cloudflare Access keys") from e
            return
        self._keys = {k.key_id: k for k in key_set.keys if k.key_id is not None}
        self._fetched_at = time.monotonic()


_jwks = _JwksCache()


def token_from(request: Request) -> str | None:
    return request.headers.get(JWT_HEADER) or request.cookies.get(JWT_COOKIE)


def email_from_claims(claims: dict[str, Any]) -> str:
    """The user's email, normalized, or a 403 naming what was wrong.

    Service tokens are the case worth being explicit about: they verify
    perfectly and carry `common_name` instead of `email`, so a machine
    credential would otherwise land as a user with a blank address, and every
    such credential would share one row.
    """
    email = claims.get("email")
    if not isinstance(email, str) or not email.strip():
        if claims.get("common_name"):
            raise HTTPException(403, "service tokens have no user identity")
        raise HTTPException(403, "Access token carries no email claim")
    return email.strip().lower()


async def verified_email(request: Request, config: Settings) -> str:
    """The caller's email, from a verified token — or the dev identity when no
    audience is configured. The only way an unverified request gets an
    identity is if `access_aud` is empty, which a deployment must not do.
    """
    if not config.access_aud:
        return config.dev_user_email.strip().lower()
    if not config.access_team_domain:
        # Misconfiguration, not a client error: an audience with nowhere to
        # fetch keys from can never verify anything, and silently refusing
        # every request would read as an Access policy problem.
        raise HTTPException(500, "ACCESS_AUD is set but ACCESS_TEAM_DOMAIN is not")

    token = token_from(request)
    if not token:
        raise HTTPException(403, "no Cloudflare Access token on this request")
    issuer, jwks_url = team_urls(config.access_team_domain)
    try:
        kid = jwt.get_unverified_header(token).get("kid")
    except jwt.PyJWTError as e:
        raise HTTPException(403, "malformed Access token") from e
    if not isinstance(kid, str):
        raise HTTPException(403, "Access token has no key id")

    key = await _jwks.key_for(kid, jwks_url)
    try:
        claims: dict[str, Any] = jwt.decode(
            token,
            key=key.key,
            algorithms=ALGORITHMS,
            audience=config.access_aud,
            issuer=issuer,
        )
    except jwt.PyJWTError as e:
        # Deliberately not echoing the library's reason to the client: expired
        # vs wrong-audience vs bad-signature is useful to an attacker probing
        # the audience tag and useless to a browser, which just needs to be
        # sent back through Access.
        raise HTTPException(403, "Access token failed verification") from e
    return email_from_claims(claims)


async def user_for_email(session: AsyncSession, email: str) -> User:
    """The row for this email, created on first sight.

    First-sight creation is not signup: everyone reaching this line already
    passed the Access policy, which is the invite list. The retry covers the
    race where two of a browser's parallel requests both find nothing.
    """
    user = await session.scalar(select(User).where(User.email == email))
    if user is not None:
        return user
    user = User(email=email)
    session.add(user)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        existing = await session.scalar(select(User).where(User.email == email))
        if existing is None:
            raise
        return existing
    await session.refresh(user)
    return user


async def current_user(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> User:
    """The dependency every owned route takes. Reads module `settings` rather
    than taking them as a parameter so route signatures stay about the route;
    `verified_email` keeps the config argument so tests can drive both modes.
    """
    return await user_for_email(session, await verified_email(request, settings))
