"""Identity without a database (DECISIONS.md #58): the mode switch, the
origin check, the cookie flags and the Discord client against a
`MockTransport`. The login flow end to end, which needs `sessions` rows,
is test_login.py; owner scoping is test_isolation.py.
"""
from __future__ import annotations

import json
from typing import Any, cast

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app import auth, discord
from app.config import Settings

ORIGIN = "https://umalab.example.com"


def request_with(method: str = "GET", **headers: str) -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    return Request({"type": "http", "headers": raw, "method": method, "path": "/"})


def discord_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "discord_client_id": "client",
        "discord_client_secret": "secret",
        "discord_guild_id": "1",
        "discord_role_ids": "10, 20",
        "public_origin": ORIGIN,
    }
    values.update(overrides)
    return Settings(**values)  # pyright: ignore[reportCallIssue]


# `session_user` returns before touching the session when there is no
# token, which is the only path these tests take.
NO_DB = cast(AsyncSession, None)


# ---------- the two modes ----------

async def test_configured_without_a_cookie_is_refused_not_the_dev_user():
    """The bug this whole design exists to prevent: a deployment that names
    a client must refuse, not serve the dev identity's rows."""
    with pytest.raises(HTTPException) as e:
        await auth.authenticated_user(request_with(), NO_DB, discord_settings())
    assert e.value.status_code == 401


async def test_configured_without_a_public_origin_is_a_server_error():
    with pytest.raises(HTTPException) as e:
        await auth.authenticated_user(
            request_with(), NO_DB, discord_settings(public_origin="")
        )
    assert e.value.status_code == 500


def test_a_blank_dev_user_email_is_refused():
    """It would otherwise create a user whose email is "" — a second,
    orphaned owner, and the symptom is "my data disappeared"."""
    with pytest.raises(HTTPException) as e:
        auth.dev_email(Settings(dev_user_email="   "))  # pyright: ignore[reportCallIssue]
    assert e.value.status_code == 500


def test_dev_email_is_normalized():
    assert auth.dev_email(Settings(dev_user_email="Dev@Localhost")) == "dev@localhost"  # pyright: ignore[reportCallIssue]


def test_role_ids_are_split_and_trimmed():
    assert discord_settings().discord_role_id_set == {"10", "20"}
    assert discord_settings(discord_role_ids="").discord_role_id_set == frozenset()


# ---------- the origin check ----------

def test_safe_methods_never_check_origin():
    auth.require_same_origin(
        request_with("GET", origin="https://evil.example"), discord_settings()
    )


def test_an_unsafe_request_from_the_app_origin_passes():
    auth.require_same_origin(request_with("POST", origin=ORIGIN), discord_settings())


def test_an_unsafe_request_from_another_site_is_refused():
    """A hidden form on any other page posting the multipart import — the
    cookie's SameSite=Lax already withholds the credential; this is the
    defense that does not depend on it."""
    with pytest.raises(HTTPException) as e:
        auth.require_same_origin(
            request_with("POST", origin="https://evil.example"), discord_settings()
        )
    assert e.value.status_code == 403


def test_an_unsafe_request_without_an_origin_passes():
    """Browsers always send one on non-GET; its absence is a script, and a
    script with the cookie is not CSRF."""
    auth.require_same_origin(request_with("POST"), discord_settings())


# ---------- cookies ----------

def test_secure_follows_the_public_origin_not_the_request():
    assert auth.cookie_secure(discord_settings())
    assert not auth.cookie_secure(discord_settings(public_origin="http://localhost:8788"))


def test_the_cookie_stores_only_a_hash():
    token = auth.new_token()
    assert auth.hash_token(token) != token
    assert len(auth.hash_token(token)) == 64


# ---------- the Discord client ----------

def mock_discord(
    *,
    token: int | dict[str, Any] = 200,
    me: int | dict[str, Any] = 200,
    member: int | dict[str, Any] = 200,
) -> httpx.AsyncClient:
    """A Discord that answers the three calls; an int is a bare status."""
    defaults: dict[str, dict[str, Any]] = {
        "/oauth2/token": {"access_token": "tok", "token_type": "Bearer"},
        "/users/@me": {
            "id": "123",
            "username": "jason",
            "global_name": "Jason",
            "email": "Jason@Example.com",
            "verified": True,
        },
        "/users/@me/guilds/1/member": {"roles": ["10", "99"]},
    }
    answers = {
        "/oauth2/token": token,
        "/users/@me": me,
        "/users/@me/guilds/1/member": member,
    }

    def handle(request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix("/api/v10")
        answer = answers[path]
        if isinstance(answer, int) and answer != 200:
            return httpx.Response(answer)
        body = {**defaults[path], **(answer if isinstance(answer, dict) else {})}
        return httpx.Response(200, content=json.dumps(body).encode())

    return httpx.AsyncClient(transport=httpx.MockTransport(handle))


def test_authorize_url_names_the_scopes_and_state():
    url = discord.authorize_url("client", f"{ORIGIN}/api/auth/callback", "nonce")
    assert url.startswith(discord.AUTHORIZE_URL + "?")
    assert "scope=identify+email+guilds.members.read" in url
    assert "state=nonce" in url
    assert "redirect_uri=https%3A%2F%2Fumalab.example.com%2Fapi%2Fauth%2Fcallback" in url


async def exchange(client: httpx.AsyncClient) -> str:
    return await discord.exchange_code(
        client, client_id="c", client_secret="s", code="code", redirect_uri="r"
    )


async def test_a_failed_exchange_is_a_discord_error():
    with pytest.raises(discord.DiscordError):
        await exchange(mock_discord(token=400))


async def test_an_exchange_without_a_token_is_a_discord_error():
    with pytest.raises(discord.DiscordError):
        await exchange(mock_discord(token={"access_token": ""}))


async def test_a_verified_email_is_normalized():
    account = await discord.fetch_account(mock_discord(), "tok")
    assert account == discord.Account(id="123", name="Jason", email="jason@example.com")


async def test_an_unverified_email_is_dropped():
    """An unverified address proves nothing, and adopting a row on it would
    hand an Access-era roster to whoever typed that address into Discord."""
    account = await discord.fetch_account(mock_discord(me={"verified": False}), "tok")
    assert account.email is None


async def test_username_is_the_fallback_for_no_global_name():
    account = await discord.fetch_account(mock_discord(me={"global_name": None}), "tok")
    assert account.name == "jason"


async def test_an_account_without_an_id_is_a_discord_error():
    with pytest.raises(discord.DiscordError):
        await discord.fetch_account(mock_discord(me={"id": "not-a-snowflake"}), "tok")


async def test_a_non_member_is_none_not_an_error():
    assert await discord.fetch_member_roles(mock_discord(member=404), "tok", "1") is None


async def test_member_roles_are_returned_as_a_set():
    roles = await discord.fetch_member_roles(mock_discord(), "tok", "1")
    assert roles == {"10", "99"}


async def test_a_member_object_without_roles_is_a_discord_error():
    with pytest.raises(discord.DiscordError):
        await discord.fetch_member_roles(mock_discord(member={"roles": None}), "tok", "1")


async def test_any_other_member_status_is_a_discord_error():
    with pytest.raises(discord.DiscordError):
        await discord.fetch_member_roles(mock_discord(member=500), "tok", "1")
