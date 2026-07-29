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

    # Used only by scripts/build_reference_data.py (which reads .env itself,
    # stdlib-only); declared here so pydantic-settings accepts the .env entry.
    uma_moe_api_key: str = ""


settings = Settings()
