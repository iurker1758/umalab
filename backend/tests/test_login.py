"""The login end to end (DECISIONS.md #58), through the real routes with
Discord mocked at the transport and the identity settings forced into
Discord mode — what a deployment runs, minus discord.com.

Needs the test database like test_isolation.py; same skip / CI rules.
"""
from __future__ import annotations

from collections.abc import AsyncGenerator
from datetime import timedelta
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
import pytest_asyncio
from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import auth
from app.database import get_session
from app.main import app
from app.models import Session, User
from app.routers.auth import STATE_COOKIE, get_discord_client, get_settings
from tests.test_auth import ORIGIN, discord_settings, mock_discord

pytestmark = pytest.mark.usefixtures("sessions")


@pytest_asyncio.fixture
async def client(
    sessions: async_sessionmaker[AsyncSession],
) -> AsyncGenerator[httpx.AsyncClient, None]:
    """An anonymous browser against the app in Discord mode. Cookies
    persist across requests the way a browser's do; redirects are NOT
    followed, so each hop is asserted on its own."""

    async def override_session() -> AsyncGenerator[AsyncSession, None]:
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_settings] = lambda: discord_settings()
    app.dependency_overrides[get_discord_client] = lambda: mock_discord()
    # `current_user` reads module settings; point the dependency at the same
    # Discord-mode settings the routes see.
    app.dependency_overrides[auth.current_user] = _current_user_in_discord_mode(sessions)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url=ORIGIN
    ) as c:
        yield c
    app.dependency_overrides.clear()


def _current_user_in_discord_mode(sessions: async_sessionmaker[AsyncSession]):
    async def dependency(request: Request) -> User:
        async with sessions() as session:
            return await auth.authenticated_user(request, session, discord_settings())

    return dependency


def discord_answers(**answers: Any) -> None:
    app.dependency_overrides[get_discord_client] = lambda: mock_discord(**answers)


async def sign_in(client: httpx.AsyncClient) -> httpx.Response:
    """Login → Discord → callback, returning the callback's response."""
    login = await client.get("/api/auth/login")
    assert login.status_code == 303
    state = parse_qs(urlparse(login.headers["location"]).query)["state"][0]
    return await client.get("/api/auth/callback", params={"code": "c", "state": state})


# ---------- the happy path ----------

async def test_login_redirects_to_discord_with_a_state_cookie(client: httpx.AsyncClient):
    response = await client.get("/api/auth/login")
    assert response.status_code == 303
    target = urlparse(response.headers["location"])
    assert target.netloc == "discord.com"
    query = parse_qs(target.query)
    assert query["redirect_uri"] == [f"{ORIGIN}/api/auth/callback"]
    assert query["state"] == [client.cookies[STATE_COOKIE]]


async def test_a_member_with_the_role_gets_a_session(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
):
    response = await sign_in(client)
    assert response.status_code == 303
    assert response.headers["location"] == "/"
    assert auth.SESSION_COOKIE in client.cookies
    assert STATE_COOKIE not in client.cookies
    set_cookie = response.headers["set-cookie"]
    assert "HttpOnly" in set_cookie
    assert "SameSite=lax" in set_cookie
    assert "Secure" in set_cookie

    me = await client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["name"] == "Jason"

    async with sessions() as session:
        user = await session.scalar(select(User).where(User.discord_id == "123"))
        assert user is not None
        assert user.email == "jason@example.com"
        row = await session.scalar(select(Session))
        assert row is not None
        assert row.token_hash == auth.hash_token(client.cookies[auth.SESSION_COOKIE])
        assert row.token_hash != client.cookies[auth.SESSION_COOKIE]


async def test_owned_routes_answer_to_the_cookie(client: httpx.AsyncClient):
    assert (await client.get("/api/veterans")).status_code == 401
    await sign_in(client)
    assert (await client.get("/api/veterans")).status_code == 200


async def test_logout_ends_the_session_for_good(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
):
    await sign_in(client)
    token = client.cookies[auth.SESSION_COOKIE]
    out = await client.post("/api/auth/logout")
    assert out.status_code == 204
    assert auth.SESSION_COOKIE not in client.cookies
    # A copy of the cookie kept elsewhere is dead too: the row is gone.
    client.cookies.set(auth.SESSION_COOKIE, token)
    assert (await client.get("/api/auth/me")).status_code == 401
    async with sessions() as session:
        assert await session.scalar(select(Session)) is None


async def test_a_second_login_refreshes_the_name_and_keeps_the_row(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
):
    await sign_in(client)
    discord_answers(me={"global_name": "Jay"})
    await sign_in(client)
    async with sessions() as session:
        users = (await session.scalars(select(User))).all()
        assert [u.name for u in users] == ["Jay"]


# ---------- refusals ----------

@pytest.mark.parametrize(
    ("answers", "code"),
    [
        ({"member": 404}, "not_member"),
        ({"member": {"roles": ["99"]}}, "no_role"),
        ({"token": 400}, "discord"),
        ({"me": 500}, "discord"),
    ],
)
async def test_refusals_land_on_the_sign_in_screen_without_a_cookie(
    client: httpx.AsyncClient,
    sessions: async_sessionmaker[AsyncSession],
    answers: dict[str, Any],
    code: str,
):
    discord_answers(**answers)
    response = await sign_in(client)
    assert response.status_code == 303
    assert response.headers["location"] == f"/signin?error={code}"
    assert auth.SESSION_COOKIE not in client.cookies
    async with sessions() as session:
        assert (await session.scalars(select(User))).all() == []


async def test_cancelling_on_discord_is_reported_as_denied(client: httpx.AsyncClient):
    await client.get("/api/auth/login")
    response = await client.get("/api/auth/callback", params={"error": "access_denied"})
    assert response.headers["location"] == "/signin?error=denied"


async def test_a_callback_whose_state_does_not_match_is_refused(client: httpx.AsyncClient):
    """Login CSRF: an attacker's code completed in the victim's browser. The
    state cookie is the victim's; the state parameter is the attacker's."""
    await client.get("/api/auth/login")
    response = await client.get("/api/auth/callback", params={"code": "c", "state": "theirs"})
    assert response.headers["location"] == "/signin?error=state"
    assert auth.SESSION_COOKIE not in client.cookies


async def test_a_callback_without_a_state_cookie_is_refused(client: httpx.AsyncClient):
    response = await client.get("/api/auth/callback", params={"code": "c", "state": "x"})
    assert response.headers["location"] == "/signin?error=state"


# ---------- identity ----------

async def test_a_first_login_adopts_the_access_era_row(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
):
    """The roster an Access login built follows its owner across the switch,
    matched on the verified address."""
    async with sessions() as session:
        session.add(User(email="jason@example.com"))
        await session.commit()
    await sign_in(client)
    async with sessions() as session:
        users = (await session.scalars(select(User))).all()
        assert len(users) == 1
        assert users[0].discord_id == "123"
        assert users[0].name == "Jason"


async def test_an_unverified_email_adopts_nothing(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
):
    async with sessions() as session:
        session.add(User(email="jason@example.com"))
        await session.commit()
    discord_answers(me={"verified": False})
    await sign_in(client)
    async with sessions() as session:
        users = (await session.scalars(select(User).order_by(User.id))).all()
        assert [(u.email, u.discord_id) for u in users] == [
            ("jason@example.com", None),
            (None, "123"),
        ]


async def test_an_email_already_claimed_by_another_account_is_not_reused(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
):
    async with sessions() as session:
        session.add(User(email="jason@example.com", discord_id="999"))
        await session.commit()
    await sign_in(client)
    async with sessions() as session:
        mine = await session.scalar(select(User).where(User.discord_id == "123"))
        assert mine is not None
        assert mine.email is None


# ---------- sessions ----------

async def test_an_expired_session_is_refused_and_reaped(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
):
    await sign_in(client)
    async with sessions() as session:
        row = await session.scalar(select(Session))
        assert row is not None
        row.expires_at = auth.utcnow() - timedelta(seconds=1)
        await session.commit()
    assert (await client.get("/api/auth/me")).status_code == 401
    async with sessions() as session:
        assert await session.scalar(select(Session)) is None


async def test_a_forged_cookie_is_refused(client: httpx.AsyncClient):
    client.cookies.set(auth.SESSION_COOKIE, auth.new_token())
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_a_cross_site_logout_is_refused(client: httpx.AsyncClient):
    """Lax withholds the cookie on the way in, but the clearing Set-Cookie on
    the way out would still land; the Origin check is what stops it."""
    await sign_in(client)
    response = await client.post("/api/auth/logout", headers={"Origin": "https://evil.example"})
    assert response.status_code == 403
    assert (await client.get("/api/auth/me")).status_code == 200


async def test_a_cross_site_write_is_refused_even_with_the_cookie(client: httpx.AsyncClient):
    """The multipart import needs no preflight, so a hidden form on another
    site can post it; the Origin check is what turns that away when the
    cookie arrives anyway."""
    await sign_in(client)
    response = await client.post(
        "/api/imports",
        files={"file": ("data.json", b"{}", "application/json")},
        headers={"Origin": "https://evil.example"},
    )
    assert response.status_code == 403
