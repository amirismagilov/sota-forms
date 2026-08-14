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

    # Base URL of the built-in mock external API (for the demo API dictionary).
    mock_ext_base: str = "http://backend:8000/api/mock/ext"

    # ---- sota-bpmn (Operaton BFF) ----
    # Where the process/forms catalogue and the task-complete endpoint live.
    # Empty string disables the whole Operaton integration.
    sota_bpmn_base: str = "http://host.docker.internal:8001"
    # Shared secret sent as X-Forms-Token when completing an Operaton task.
    # Must match FORMS_WEBHOOK_TOKEN on the sota-bpmn side; empty = no header.
    sota_bpmn_token: str = ""
    sota_bpmn_timeout: int = 10000  # ms

    # ---- Auto-sync of the Operaton form catalogue ----
    # When on, a background loop pulls newly deployed process forms into the
    # registry, so a process deployed in sota-bpmn shows up here without anyone
    # pressing a button. Off by default: importing into someone's account on a
    # timer is only wanted when explicitly asked for.
    operaton_auto_sync: bool = False
    operaton_sync_interval: int = 300  # seconds between passes
    # Which account receives the forms. Empty = default_account_id.
    operaton_sync_account: str = ""
    # Publish imported forms immediately. Off by default — a form pulled by a
    # timer has been reviewed by nobody, and publishing makes it live for tasks.
    operaton_sync_publish: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
