from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://forms:forms@db:5432/forms"
    redis_url: str = "redis://redis:6379/0"

    # Fernet key for encrypting connection secrets at rest.
    # A default is provided for the demo; override in production.
    secret_key: str = "Xr8pJqZ4nL2vT6wY0aB3cD5eF7gH9iK1mN4oP6qR8s="

    # HMAC signing key for outbound webhook payloads.
    webhook_hmac_secret: str = "demo-hmac-secret-change-me"

    default_account_id: str = "acc_demo"
    cors_origins: str = "*"

    # Where the seeded demo form delivers webhooks (self-hosted mock client).
    # In docker-compose this is the backend service name; override for local runs.
    mock_webhook_url: str = "http://backend:8000/api/mock/webhook"


@lru_cache
def get_settings() -> Settings:
    return Settings()
