"""The three Discord calls a login needs (DECISIONS.md #58), with no FastAPI
in them: code → token, token → account, token → guild member. Every
function takes the `httpx.AsyncClient` so tests drive them through a
`MockTransport` and the router owns the real client's lifetime.

Scopes: `identify` for the account, `email` so a first login can adopt the
row an Access-era login left behind, `guilds.members.read` for the member
object — which carries the roles — in the one guild we name. The user's own
token reads that, so there is no bot and no bot token.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx

API = "https://discord.com/api/v10"
AUTHORIZE_URL = "https://discord.com/oauth2/authorize"
SCOPES = "identify email guilds.members.read"

# Discord's hard limit on a username / global name, mirrored by `users.name`.
NAME_MAX = 100


class DiscordError(Exception):
    """Discord answered something the login can't work with — a failed token
    exchange, a non-JSON body, a member object without roles. Not "the user
    isn't a member": that is a normal outcome and has its own result."""


@dataclass(frozen=True)
class Account:
    id: str
    name: str
    # Only a VERIFIED address, or None: an unverified one proves nothing and
    # must never adopt a row.
    email: str | None


def authorize_url(client_id: str, redirect_uri: str, state: str) -> str:
    query = urlencode(
        {
            "client_id": client_id,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "scope": SCOPES,
            "state": state,
        }
    )
    return f"{AUTHORIZE_URL}?{query}"


def _json(response: httpx.Response) -> dict[str, Any]:
    try:
        data: Any = response.json()
    except ValueError as e:
        raise DiscordError(f"non-JSON body from {response.url}") from e
    if not isinstance(data, dict):
        raise DiscordError(f"unexpected body from {response.url}")
    return data  # pyright: ignore[reportUnknownVariableType]


async def exchange_code(
    client: httpx.AsyncClient,
    *,
    client_id: str,
    client_secret: str,
    code: str,
    redirect_uri: str,
) -> str:
    """The access token for an authorization code."""
    response = await client.post(
        f"{API}/oauth2/token",
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
        },
        headers={"Accept": "application/json"},
    )
    if response.status_code != 200:
        raise DiscordError(f"token exchange answered {response.status_code}")
    token = _json(response).get("access_token")
    if not isinstance(token, str) or not token:
        raise DiscordError("token exchange carried no access_token")
    return token


async def fetch_account(client: httpx.AsyncClient, token: str) -> Account:
    response = await client.get(
        f"{API}/users/@me", headers={"Authorization": f"Bearer {token}"}
    )
    if response.status_code != 200:
        raise DiscordError(f"/users/@me answered {response.status_code}")
    data = _json(response)
    user_id = data.get("id")
    if not isinstance(user_id, str) or not user_id.isdigit():
        raise DiscordError("/users/@me carried no id")
    # global_name is the display name users actually set; username is the
    # unique handle and the fallback for accounts that never set one.
    name = data.get("global_name") or data.get("username") or ""
    if not isinstance(name, str):
        name = ""
    email = data.get("email")
    verified = email if isinstance(email, str) and data.get("verified") is True else None
    return Account(
        id=user_id,
        name=name[:NAME_MAX],
        email=verified.strip().lower() if verified else None,
    )


async def fetch_member_roles(
    client: httpx.AsyncClient, token: str, guild_id: str
) -> frozenset[str] | None:
    """The role ids the account holds in `guild_id`, or None when it is not a
    member there at all."""
    response = await client.get(
        f"{API}/users/@me/guilds/{guild_id}/member",
        headers={"Authorization": f"Bearer {token}"},
    )
    if response.status_code == 404:
        return None
    if response.status_code != 200:
        raise DiscordError(f"guild member lookup answered {response.status_code}")
    roles = _json(response).get("roles")
    if not isinstance(roles, list):
        raise DiscordError("member object carried no roles")
    return frozenset(r for r in roles if isinstance(r, str))  # pyright: ignore[reportUnknownVariableType]
