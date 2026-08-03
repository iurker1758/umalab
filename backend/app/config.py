"""App settings. Values come from (highest precedence first): real environment
variables, then backend/.env, then the defaults here. See .env.example.
"""
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/.env — anchored to this file so it's found regardless of CWD
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8")

    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost/umalab"

    # ---------- Cloudflare Access identity (DECISIONS.md #32) ----------
    # `access_aud` is the switch: set it and every request must carry a
    # verifiable Access JWT; leave it empty and the app runs as `dev_user_email`.
    # There is deliberately no third state — a deployment that sets an audience
    # can never fall back to the dev identity, whatever else is misconfigured.
    access_aud: str = ""
    # Team domain, e.g. "myteam.cloudflareaccess.com" — where the signing keys
    # are published. Required whenever access_aud is set.
    access_team_domain: str = ""
    # Who the app is when no audience is configured: local `uvicorn --reload`,
    # pytest, and the Playwright suite, none of which have Access in front of
    # them. Also the owner the first migration assigns every existing row to.
    dev_user_email: str = "dev@localhost"

    # Used only by scripts/build_reference_data.py (which reads .env itself,
    # stdlib-only); declared here so pydantic-settings accepts the .env entry.
    uma_moe_api_key: str = ""


settings = Settings()
