"""Login, logout and "who am I" (DECISIONS.md #58).

`/api/auth/login` and `/api/auth/callback` are NAVIGATIONS, not fetches —
the browser follows their redirects — so they are the one place the
"no /api route answers with a redirect" rule of #55 does not apply; the
client never calls them through `request()`. The callback lands on
`/signin?error=…` when it refuses someone, and the SPA says why.

The `state` round-trip: a random nonce goes out in the authorize URL and
in a short-lived cookie; the callback accepts only a matching pair. That
stops a login CSRF — an attacker completing THEIR Discord login in the
victim's browser, so the victim imports their roster into the attacker's
account.
"""
from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import discord
from ..auth import (
    SESSION_COOKIE,
    clear_session_cookie,
    cookie_secure,
    current_user,
    end_session,
    new_token,
    set_session_cookie,
    start_session,
)
from ..config import Settings, settings
from ..database import get_session
from ..models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])

STATE_COOKIE = "umalab_oauth_state"
STATE_TTL_SECONDS = 10 * 60
CALLBACK_PATH = "/api/auth/callback"

# Codes the SPA's sign-in screen turns into sentences. A closed set on
# purpose: nothing Discord says is echoed to the browser.
DENIED = "denied"  # the user cancelled on Discord's consent screen
NOT_MEMBER = "not_member"
NO_ROLE = "no_role"
STATE_MISMATCH = "state"
UPSTREAM = "discord"


async def get_discord_client() -> AsyncGenerator[httpx.AsyncClient, None]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        yield client


def get_settings() -> Settings:
    return settings


def redirect_uri(config: Settings) -> str:
    return config.public_origin.rstrip("/") + CALLBACK_PATH


def refused(code: str) -> RedirectResponse:
    # 303: the browser arrives from Discord with a GET anyway, but a 303
    # never replays a method, whatever brought it here.
    return RedirectResponse(f"/signin?error={code}", status_code=303)


def require_configured(config: Settings) -> None:
    if not config.discord_client_id:
        raise HTTPException(404, "no login is configured; the app runs as the dev user")
    missing = [
        name
        for name, value in (
            ("DISCORD_CLIENT_SECRET", config.discord_client_secret),
            ("DISCORD_GUILD_ID", config.discord_guild_id),
            ("DISCORD_ROLE_IDS", config.discord_role_ids),
            ("PUBLIC_ORIGIN", config.public_origin),
        )
        if not value.strip()
    ]
    if missing:
        raise HTTPException(500, f"DISCORD_CLIENT_ID is set but not {', '.join(missing)}")


@router.get("/login")
async def login(config: Settings = Depends(get_settings)) -> RedirectResponse:
    require_configured(config)
    state = new_token()
    response = RedirectResponse(
        discord.authorize_url(config.discord_client_id, redirect_uri(config), state),
        status_code=303,
    )
    response.set_cookie(
        STATE_COOKIE,
        state,
        max_age=STATE_TTL_SECONDS,
        httponly=True,
        secure=cookie_secure(config),
        # Lax, not Strict: the callback is a top-level navigation ARRIVING
        # from discord.com, and Strict would withhold the cookie from it.
        samesite="lax",
        path=CALLBACK_PATH,
    )
    return response


async def user_for_account(session: AsyncSession, account: discord.Account) -> User:
    """The row for a Discord account: by snowflake; failing that, the row an
    Access-era login created for the same verified email, adopted; failing
    that, a new one. The name is refreshed every login — it is Discord's
    to change, not ours to remember."""
    user = await session.scalar(select(User).where(User.discord_id == account.id))
    if user is None and account.email:
        by_email = await session.scalar(select(User).where(User.email == account.email))
        if by_email is not None and by_email.discord_id is None:
            by_email.discord_id = account.id
            user = by_email
        elif by_email is not None:
            # The address already belongs to another Discord account; the
            # new row goes without one rather than failing the unique rule.
            account = discord.Account(id=account.id, name=account.name, email=None)
    if user is None:
        user = User(discord_id=account.id, email=account.email, name=account.name)
        session.add(user)
    else:
        user.name = account.name
    try:
        await session.commit()
    except IntegrityError:
        # Two callbacks for one account racing; the other one won.
        await session.rollback()
        existing = await session.scalar(select(User).where(User.discord_id == account.id))
        if existing is None:
            raise
        return existing
    await session.refresh(user)
    return user


@router.get("/callback")
async def callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    session: AsyncSession = Depends(get_session),
    client: httpx.AsyncClient = Depends(get_discord_client),
    config: Settings = Depends(get_settings),
) -> Response:
    require_configured(config)
    expected = request.cookies.get(STATE_COOKIE)
    if error is not None:
        response = refused(DENIED)
    elif not code or not state or not expected or state != expected:
        response = refused(STATE_MISMATCH)
    else:
        response = await _complete_login(session, client, config, code)
    response.delete_cookie(STATE_COOKIE, path=CALLBACK_PATH)
    return response


async def _complete_login(
    session: AsyncSession, client: httpx.AsyncClient, config: Settings, code: str
) -> Response:
    try:
        token = await discord.exchange_code(
            client,
            client_id=config.discord_client_id,
            client_secret=config.discord_client_secret,
            code=code,
            redirect_uri=redirect_uri(config),
        )
        account = await discord.fetch_account(client, token)
        roles = await discord.fetch_member_roles(client, token, config.discord_guild_id)
    except (discord.DiscordError, httpx.HTTPError):
        return refused(UPSTREAM)
    if roles is None:
        return refused(NOT_MEMBER)
    if not roles & config.discord_role_id_set:
        return refused(NO_ROLE)
    user = await user_for_account(session, account)
    session_token = await start_session(session, user, config)
    response = RedirectResponse("/", status_code=303)
    set_session_cookie(response, session_token, config)
    return response


@router.post("/logout", status_code=204)
async def logout(
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session),
    config: Settings = Depends(get_settings),
) -> Response:
    # Not behind `current_user`: an already-expired session must still be
    # able to clear its cookie, and an unauthenticated logout is harmless.
    await end_session(session, request.cookies.get(SESSION_COOKIE))
    response.status_code = 204
    clear_session_cookie(response, config)
    return response


class MeOut(BaseModel):
    id: int
    name: str


@router.get("/me", response_model=MeOut)
async def me(user: User = Depends(current_user)) -> Any:
    return user
