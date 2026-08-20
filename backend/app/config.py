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

    # ---------- Discord identity (DECISIONS.md #58) ----------
    # `discord_client_id` is the switch: set it and every request must carry a
    # session cookie minted by a Discord login that passed the role check;
    # leave it empty and the app runs as `dev_user_email`. There is
    # deliberately no third state — a deployment that names a client can never
    # fall back to the dev identity, whatever else is misconfigured.
    discord_client_id: str = ""
    discord_client_secret: str = ""
    # The guild (server) whose roles are the invite list, and the role ids
    # (comma-separated) any one of which admits a member. Both required
    # whenever discord_client_id is set.
    discord_guild_id: str = ""
    discord_role_ids: str = ""
    # The origin the BROWSER sees, e.g. "https://umalab.example.com": it is the
    # OAuth redirect target and the only Origin unsafe requests may carry.
    # Configured rather than read from the request, because behind the Pages
    # proxy and the tunnel the Host header names the tunnel, not the app.
    public_origin: str = ""
    session_ttl_days: int = 30
    # Who the app is when no client is configured: local `uvicorn --reload`,
    # pytest, and the Playwright suite, none of which have a login in front
    # of them. Also the owner the first migration assigns every existing row
    # to.
    dev_user_email: str = "dev@localhost"

    @property
    def discord_role_id_set(self) -> frozenset[str]:
        return frozenset(r.strip() for r in self.discord_role_ids.split(",") if r.strip())

    # Used only by scripts/build_reference_data.py (which reads .env itself,
    # stdlib-only); declared here so pydantic-settings accepts the .env entry.
    uma_moe_api_key: str = ""


settings = Settings()
