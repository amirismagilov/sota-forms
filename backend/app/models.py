from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def _uuid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _now() -> datetime:
    return datetime.now(UTC)


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uuid("acc"))
    name: Mapped[str] = mapped_column(String, nullable=False)
    design_tokens: Mapped[dict] = mapped_column(JSONB, default=dict)
    webhook_default: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uuid("usr"))
    email: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    role: Mapped[str] = mapped_column(String, default="owner")  # owner | editor | viewer
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Connection(Base):
    __tablename__ = "connections"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uuid("conn"))
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    base_url: Mapped[str] = mapped_column(String, nullable=False)
    auth_type: Mapped[str] = mapped_column(String, default="none")
    # Secrets inside auth_config are stored encrypted (see crypto.py).
    auth_config: Mapped[dict] = mapped_column(JSONB, default=dict)
    whitelist: Mapped[list] = mapped_column(JSONB, default=list)
    timeout: Mapped[int] = mapped_column(Integer, default=5000)
    rate_limit: Mapped[int] = mapped_column(Integer, default=60)
    cache: Mapped[str] = mapped_column(String, default="none")
    env: Mapped[str] = mapped_column(String, default="prod")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Dictionary(Base):
    __tablename__ = "dictionaries"
    __table_args__ = (UniqueConstraint("account_id", "code", name="uq_dict_account_code"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uuid("dict"))
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    code: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[str] = mapped_column(String, default="manual")  # manual | api
    dependencies: Mapped[list] = mapped_column(JSONB, default=list)
    attrs: Mapped[list] = mapped_column(JSONB, default=list)
    items: Mapped[list] = mapped_column(JSONB, default=list)
    api_config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Form(Base):
    __tablename__ = "forms"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uuid("form"))
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    # Globally-unique public slug: it is the embed key, so it must be
    # unambiguous across tenants.
    form_id: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    # fields/submit hold the working DRAFT copy edited in the constructor.
    grid_columns: Mapped[int] = mapped_column(Integer, default=2)
    fields: Mapped[list] = mapped_column(JSONB, default=list)
    submit: Mapped[dict] = mapped_column(JSONB, default=dict)
    # Lifecycle: draft | published | archived. The widget serves the published
    # snapshot (published_version), never the live draft.
    status: Mapped[str] = mapped_column(String, default="draft", index=True)
    version: Mapped[int] = mapped_column(Integer, default=0)  # latest published version number
    published_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    has_draft_changes: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class FormVersion(Base):
    """Immutable published snapshot of a form's schema (history + rollback)."""

    __tablename__ = "form_versions"
    __table_args__ = (UniqueConstraint("form_pk", "version", name="uq_formversion"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uuid("fver"))
    form_pk: Mapped[str] = mapped_column(ForeignKey("forms.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    grid_columns: Mapped[int] = mapped_column(Integer, default=2)
    fields: Mapped[list] = mapped_column(JSONB, default=list)
    submit: Mapped[dict] = mapped_column(JSONB, default=dict)
    note: Mapped[str | None] = mapped_column(String, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Submission(Base):
    __tablename__ = "submissions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uuid("sub"))
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    form_id: Mapped[str] = mapped_column(String, index=True)
    data: Mapped[dict] = mapped_column(JSONB, default=dict)
    webhook_status: Mapped[str] = mapped_column(String, default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class StoredFile(Base):
    """Uploaded file for `file`/`image`/`signature` fields."""

    __tablename__ = "stored_files"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uuid("file"))
    filename: Mapped[str] = mapped_column(String, nullable=False)
    content_type: Mapped[str] = mapped_column(String, default="application/octet-stream")
    size: Mapped[int] = mapped_column(Integer, default=0)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class WebhookDelivery(Base):
    """Outbox row driving the execute-worker (доска доставок)."""

    __tablename__ = "webhook_deliveries"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uuid("whd"))
    submission_id: Mapped[str] = mapped_column(ForeignKey("submissions.id"), index=True)
    form_id: Mapped[str] = mapped_column(String, index=True)
    url: Mapped[str] = mapped_column(String, nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String, default="pending", index=True)  # pending|delivered|failed|dead
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=5)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    last_status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
