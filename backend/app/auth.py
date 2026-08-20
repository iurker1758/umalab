"""Who is asking (DECISIONS.md #32, #58).

Discord is the login: `routers/auth.py` runs the OAuth dance, checks the
member's roles in the configured guild and mints a session; this module
turns that session's cookie back into a `users` row on every request.

Two modes, and `discord_client_id` is the switch:

- **client configured** — every identity-bearing route must carry a session
  cookie whose hash is in `sessions` and not yet expired. Anything else is a
  401. The reference routes (`/api/catalog`, `/api/factors`, `/api/affinity`)
  never take the dependency — committed public data, no user rows, issue
  #116 — so they answer without one, in either mode. There
  is no fall back to the dev identity from here; that is the whole point of
  making one setting decide.
- **no client** — the app runs as `dev_user_email`. Local `uvicorn
  --reload`, pytest and the Playwright suite have no login in front of them
  and would otherwise be unable to make a single request.

The cookie is an ambient credential: the browser attaches it to a cross-site
form post, and `POST /api/imports` is multipart — a CORS-simple request that
needs no preflight — so a hidden auto-submitting form on any other page
could run the victim's full-replace import and destroy their roster. Two
independent things stop that: the cookie is `SameSite=Lax`, so a cross-site
POST never carries it, and `require_same_origin` refuses any unsafe request
whose `Origin` names a site other than `public_origin`. Either alone would
do; both, because the first depends on browser behavior and the second on a
header a non-browser client may omit.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .config import Settings, settings
from .database import get_session
from .models import Session, User

SESSION_COOKIE = "umalab_session"

# Under SameSite=Lax only these travel cross-site with the cookie attached.
# Listed anyway, because the Origin check is the defense that does not
# depend on the cookie flag.
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(32)


def utcnow() -> datetime:
    """Naive UTC, matching the timezone-less DateTime columns."""
    return datetime.now(UTC).replace(tzinfo=None)


def cookie_secure(config: Settings) -> bool:
    """`Secure` follows the public origin's scheme, not the request's: behind
    the TLS-terminating tunnel every request arrives as plain http."""
    return config.public_origin.startswith("https://")


def set_session_cookie(response: Response, token: str, config: Settings) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=config.session_ttl_days * 24 * 3600,
        httponly=True,
        secure=cookie_secure(config),
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response, config: Settings) -> None:
    response.delete_cookie(
        SESSION_COOKIE,
        path="/",
        httponly=True,
        secure=cookie_secure(config),
        samesite="lax",
    )


def require_same_origin(request: Request, config: Settings) -> None:
    """403 for an unsafe request whose Origin is another site. A missing
    Origin passes: browsers send it on every non-GET request, so its absence
    means a non-browser client, and those are not what CSRF is about."""
    if request.method in SAFE_METHODS:
        return
    origin = request.headers.get("origin")
    if origin is None:
        return
    if origin.rstrip("/") != config.public_origin.rstrip("/"):
        raise HTTPException(403, "cross-origin request refused")


def dev_email(config: Settings) -> str:
    email = config.dev_user_email.strip().lower()
    if not email:
        # An empty setting would otherwise create and use a user whose
        # email is "" — a second, orphaned owner that reads as "my data
        # disappeared" with nothing in the logs. Refuse instead.
        raise HTTPException(
            500, "DEV_USER_EMAIL is empty and no DISCORD_CLIENT_ID is configured"
        )
    return email


async def dev_user(session: AsyncSession, config: Settings) -> User:
    """The dev identity's row, created on first sight."""
    email = dev_email(config)
    user = await session.scalar(select(User).where(User.email == email))
    if user is not None:
        if not user.name:
            # A row the Access era created, before names existed.
            user.name = "dev"
            await session.commit()
        return user
    user = User(email=email, name="dev")
    session.add(user)
    try:
        await session.commit()
    except IntegrityError:
        # Two of a browser's parallel first requests both found nothing.
        await session.rollback()
        existing = await session.scalar(select(User).where(User.email == email))
        if existing is None:
            raise
        return existing
    await session.refresh(user)
    return user


async def session_user(session: AsyncSession, token: str | None) -> User | None:
    """The user a cookie token stands for, or None for no/unknown/expired."""
    if not token:
        return None
    row = await session.scalar(select(Session).where(Session.token_hash == hash_token(token)))
    if row is None:
        return None
    if row.expires_at <= utcnow():
        # Lazy reaping: an expired row goes when next presented, and
        # `start_session` sweeps the rest. No background job.
        await session.execute(delete(Session).where(Session.token_hash == row.token_hash))
        await session.commit()
        return None
    return await session.get(User, row.user_id)


async def start_session(session: AsyncSession, user: User, config: Settings) -> str:
    """Mint a session for `user`, returning the cookie token (never stored)."""
    now = utcnow()
    await session.execute(delete(Session).where(Session.expires_at <= now))
    token = new_token()
    session.add(
        Session(
            token_hash=hash_token(token),
            user_id=user.id,
            expires_at=now + timedelta(days=config.session_ttl_days),
        )
    )
    await session.commit()
    return token


async def end_session(session: AsyncSession, token: str | None) -> None:
    if not token:
        return
    await session.execute(delete(Session).where(Session.token_hash == hash_token(token)))
    await session.commit()


async def authenticated_user(request: Request, session: AsyncSession, config: Settings) -> User:
    """The caller's row — or the dev identity when no client is configured.
    The only way an unauthenticated request gets an identity is if
    `discord_client_id` is empty, which a deployment must not do.
    """
    if not config.discord_client_id:
        return await dev_user(session, config)
    if not config.public_origin:
        # Misconfiguration, not a client error: without the public origin
        # nothing can log in, and refusing silently would read as "my
        # session keeps expiring".
        raise HTTPException(500, "DISCORD_CLIENT_ID is set but PUBLIC_ORIGIN is not")
    require_same_origin(request, config)
    user = await session_user(session, request.cookies.get(SESSION_COOKIE))
    if user is None:
        raise HTTPException(401, "not signed in")
    return user


async def current_user(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> User:
    """The dependency every owned route takes. Reads module `settings` rather
    than taking them as a parameter so route signatures stay about the route;
    `authenticated_user` keeps the config argument so tests can drive both
    modes.
    """
    return await authenticated_user(request, session, settings)
