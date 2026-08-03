"""Cloudflare Access identity (DECISIONS.md #32).

Real RS256 tokens against a locally generated key, primed into the JWKS
cache — the alternative is mocking `jwt.decode`, which would leave the
audience, issuer and expiry checks (the entire security value) untested.

No network and no database here. The owner-scoping half of multi-user is
covered in test_isolation.py, which needs Postgres.
"""
from __future__ import annotations

import datetime as dt
import time
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from jwt.algorithms import RSAAlgorithm
from starlette.requests import Request

from app import auth
from app.config import Settings

TEAM = "myteam.cloudflareaccess.com"
ISSUER = f"https://{TEAM}"
AUD = "abc123def456"
KID = "test-key-1"


@pytest.fixture(scope="module")
def signing_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(autouse=True)
def primed_cache(signing_key: rsa.RSAPrivateKey):
    """Put the public key in the cache and freeze it there.

    `_fetched_at` is set to now, so nothing in these tests reaches the
    network; a test that wants the unknown-kid path asks for a kid that
    isn't here and gets the same 403 a real unknown key produces, because
    the refetch is rate-limited by the same clock.
    """
    jwk: dict[str, Any] = dict(
        RSAAlgorithm.to_jwk(signing_key.public_key(), as_dict=True)
    )
    jwk.update({"kid": KID, "alg": "RS256", "use": "sig"})
    auth._jwks._keys = {KID: jwt.PyJWK(jwk)}  # pyright: ignore[reportPrivateUsage]
    auth._jwks._fetched_at = time.monotonic()  # pyright: ignore[reportPrivateUsage]
    auth._jwks._attempted_at = time.monotonic()  # pyright: ignore[reportPrivateUsage]
    yield
    auth._jwks._keys = {}  # pyright: ignore[reportPrivateUsage]
    auth._jwks._fetched_at = None  # pyright: ignore[reportPrivateUsage]
    auth._jwks._attempted_at = None  # pyright: ignore[reportPrivateUsage]


def token(
    signing_key: rsa.RSAPrivateKey,
    *,
    aud: str = AUD,
    issuer: str = ISSUER,
    kid: str = KID,
    expires_in: int = 3600,
    **claims: Any,
) -> str:
    now = dt.datetime.now(tz=dt.UTC)
    payload: dict[str, Any] = {
        "aud": aud,
        "iss": issuer,
        "iat": now,
        "exp": now + dt.timedelta(seconds=expires_in),
        "email": "someone@example.com",
        **claims,
    }
    return jwt.encode(payload, signing_key, algorithm="RS256", headers={"kid": kid})


def request_with(token: str | None = None, cookie: str | None = None) -> Request:
    headers: list[tuple[bytes, bytes]] = []
    if token is not None:
        headers.append((auth.JWT_HEADER.lower().encode(), token.encode()))
    if cookie is not None:
        # Named here rather than imported from auth: the app deliberately has
        # no such constant any more, and this is the attacker's spelling.
        headers.append((b"cookie", f"CF_Authorization={cookie}".encode()))
    return Request({"type": "http", "headers": headers, "method": "GET", "path": "/"})


def access_settings(**overrides: Any) -> Settings:
    return Settings(
        access_aud=AUD, access_team_domain=TEAM, **overrides
    )  # pyright: ignore[reportCallIssue]


# ---------- the two modes ----------

async def test_no_audience_configured_runs_as_the_dev_user():
    config = Settings(dev_user_email="Dev@Localhost")  # pyright: ignore[reportCallIssue]
    assert await auth.verified_email(request_with(), config) == "dev@localhost"


async def test_no_audience_ignores_a_token_entirely(signing_key: rsa.RSAPrivateKey):
    """Dev mode does not half-authenticate: a token on the request changes
    nothing, so local runs can't accidentally depend on one being there."""
    config = Settings(dev_user_email="dev@localhost")  # pyright: ignore[reportCallIssue]
    request = request_with(token(signing_key, email="someone@example.com"))
    assert await auth.verified_email(request, config) == "dev@localhost"


async def test_audience_configured_never_falls_back_to_the_dev_user():
    """The bug this whole design exists to prevent: a deployment that has an
    audience must refuse, not serve the dev identity's rows."""
    with pytest.raises(HTTPException) as e:
        await auth.verified_email(request_with(), access_settings())
    assert e.value.status_code == 403


async def test_a_blank_dev_user_email_is_refused():
    """It would otherwise create a user whose email is "" — a second,
    orphaned owner, and the symptom is "my data disappeared"."""
    config = Settings(dev_user_email="   ")  # pyright: ignore[reportCallIssue]
    with pytest.raises(HTTPException) as e:
        await auth.verified_email(request_with(), config)
    assert e.value.status_code == 500


async def test_audience_without_a_team_domain_is_a_server_error():
    config = Settings(access_aud=AUD)  # pyright: ignore[reportCallIssue]
    with pytest.raises(HTTPException) as e:
        await auth.verified_email(request_with("whatever"), config)
    assert e.value.status_code == 500


# ---------- verification ----------

async def test_a_valid_token_yields_its_email(signing_key: rsa.RSAPrivateKey):
    request = request_with(token(signing_key, email="Jason@Example.com"))
    assert await auth.verified_email(request, access_settings()) == "jason@example.com"


async def test_the_cf_authorization_cookie_is_not_a_credential(
    signing_key: rsa.RSAPrivateKey,
):
    """A perfectly valid token in the cookie Access also sets must NOT
    authenticate. A cookie is ambient — the browser attaches it to a
    cross-site form post, and POST /api/imports is multipart (no preflight),
    so accepting it would let any page destroy a logged-in user's roster.
    """
    request = request_with(cookie=token(signing_key))
    with pytest.raises(HTTPException) as e:
        await auth.verified_email(request, access_settings())
    assert e.value.status_code == 403


@pytest.mark.parametrize(
    ("kwargs", "why"),
    [
        ({"aud": "someone-elses-app"}, "audience belongs to another Access app"),
        ({"issuer": "https://evil.cloudflareaccess.com"}, "issued by another team"),
        ({"expires_in": -60}, "expired"),
    ],
)
async def test_tokens_that_verify_against_nothing_are_refused(
    signing_key: rsa.RSAPrivateKey, kwargs: dict[str, Any], why: str
):
    request = request_with(token(signing_key, **kwargs))
    with pytest.raises(HTTPException) as e:
        await auth.verified_email(request, access_settings())
    assert e.value.status_code == 403, why


async def test_a_token_signed_by_a_different_key_is_refused():
    """Same kid, different private key — the signature check is what has to
    catch this, not anything about the claims."""
    impostor = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    request = request_with(token(impostor))
    with pytest.raises(HTTPException) as e:
        await auth.verified_email(request, access_settings())
    assert e.value.status_code == 403


async def test_an_unsigned_token_is_refused(signing_key: rsa.RSAPrivateKey):
    """alg=none, the algorithm-confusion classic. auth pins RS256 rather than
    reading the algorithm out of the token's own header."""
    now = dt.datetime.now(tz=dt.UTC)
    unsigned = jwt.encode(
        {
            "aud": AUD,
            "iss": ISSUER,
            "exp": now + dt.timedelta(hours=1),
            "email": "attacker@example.com",
        },
        key="",
        algorithm="none",
        headers={"kid": KID},
    )
    with pytest.raises(HTTPException) as e:
        await auth.verified_email(request_with(unsigned), access_settings())
    assert e.value.status_code == 403


async def test_garbage_in_the_header_is_refused():
    with pytest.raises(HTTPException) as e:
        await auth.verified_email(request_with("not-a-jwt"), access_settings())
    assert e.value.status_code == 403


async def test_an_unknown_key_id_is_refused(signing_key: rsa.RSAPrivateKey):
    request = request_with(token(signing_key, kid="rotated-away"))
    with pytest.raises(HTTPException) as e:
        await auth.verified_email(request, access_settings())
    assert e.value.status_code == 403


# ---------- the key cache ----------

# An unsupported scheme fails inside httpx before any I/O, so this exercises
# the failure path deterministically and offline.
UNREACHABLE = "ftp://certs.invalid/cdn-cgi/access/certs"


async def test_a_failed_fetch_still_starts_the_throttle_window():
    """The bound exists so an attacker sending unknown `kid` values can't
    drive unbounded outbound requests. Throttling on the last SUCCESS would
    mean a failing endpoint is never throttled at all: every request would
    retry behind the cache lock and a cert outage would read as the app
    hanging rather than as one slow request.
    """
    cache = auth._JwksCache()  # pyright: ignore[reportPrivateUsage]
    cache._keys = {KID: object()}  # type: ignore[assignment]  # pyright: ignore[reportPrivateUsage]
    assert cache._may_refetch() is True  # pyright: ignore[reportPrivateUsage]

    await cache._fetch(UNREACHABLE)  # pyright: ignore[reportPrivateUsage]

    assert cache._attempted_at is not None  # pyright: ignore[reportPrivateUsage]
    assert cache._may_refetch() is False  # pyright: ignore[reportPrivateUsage]
    # The keys it already had survive — one that verified a minute ago still
    # verifies, and a blip should not log everybody out.
    assert cache._fetched_at is None  # pyright: ignore[reportPrivateUsage]


async def test_a_failed_fetch_with_nothing_cached_is_a_503():
    """No keys and no way to get them is an outage, not a bad token — a 403
    would send the browser back through Access to be told the same thing."""
    cache = auth._JwksCache()  # pyright: ignore[reportPrivateUsage]
    with pytest.raises(HTTPException) as e:
        await cache._fetch(UNREACHABLE)  # pyright: ignore[reportPrivateUsage]
    assert e.value.status_code == 503


# ---------- claims ----------

def test_a_service_token_is_not_a_user():
    with pytest.raises(HTTPException) as e:
        auth.email_from_claims({"common_name": "ci-runner.access"})
    assert e.value.status_code == 403
    assert "service token" in str(e.value.detail)


@pytest.mark.parametrize("claims", [{}, {"email": ""}, {"email": "   "}, {"email": 42}])
def test_a_token_without_a_usable_email_is_refused(claims: dict[str, Any]):
    with pytest.raises(HTTPException) as e:
        auth.email_from_claims(claims)
    assert e.value.status_code == 403


def test_emails_are_normalized():
    assert auth.email_from_claims({"email": "  Jason@Example.COM "}) == "jason@example.com"


# ---------- team domain parsing ----------

@pytest.mark.parametrize("configured", [TEAM, f"https://{TEAM}", f"https://{TEAM}/"])
def test_the_team_domain_is_accepted_with_or_without_a_scheme(configured: str):
    issuer, jwks_url = auth.team_urls(configured)
    assert issuer == ISSUER
    assert jwks_url == f"{ISSUER}/cdn-cgi/access/certs"


# ---------- wiring ----------

def test_every_route_that_touches_owned_rows_requires_an_identity():
    """A new route that forgets Depends(current_user) reads and writes across
    all users. Nothing else in the suite would notice, so this asserts the
    wiring directly rather than the behaviour of any one route.

    The allow-list is the three stateless routes (DECISIONS.md #17) plus
    FastAPI's own docs endpoints — anything else added without an identity
    has to be justified by editing this line.
    """
    from app.main import app

    stateless = {"/api/catalog", "/api/factors", "/api/affinity"}
    unowned = {"/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"}

    missing: list[str] = []
    for route in app.routes:
        path = getattr(route, "path", None)
        if not isinstance(path, str) or path in stateless or path in unowned:
            continue
        dependant = getattr(route, "dependant", None)
        if dependant is None:
            continue
        calls = [d.call for d in dependant.dependencies]
        if auth.current_user not in calls:
            missing.append(f"{sorted(getattr(route, 'methods', []) or [])} {path}")
    assert not missing, f"routes with no identity dependency: {missing}"
