from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


# ---- Connections ----
class ConnectionIn(BaseModel):
    name: str
    base_url: str
    auth_type: str = "none"
    auth_config: dict[str, Any] = Field(default_factory=dict)
    whitelist: list[str] = Field(default_factory=list)
    timeout: int = 5000
    rate_limit: int = 60
    cache: str = "none"
    env: str = "prod"


class ConnectionOut(BaseModel):
    id: str
    name: str
    base_url: str
    auth_type: str
    auth_config: dict[str, Any]
    whitelist: list[str]
    timeout: int
    rate_limit: int
    cache: str
    env: str


class ConnectionTestIn(BaseModel):
    # Optional path appended to base_url; empty = probe the base URL itself.
    endpoint: str = ""
    method: str = "GET"


class ConnectionTestResult(BaseModel):
    ok: bool          # got a non-error HTTP response (< 400)
    reachable: bool   # the host answered at all (even with a 4xx/5xx)
    status: int | None = None
    latency_ms: int | None = None
    url: str
    message: str


# ---- Dictionaries ----
class DictionaryIn(BaseModel):
    code: str
    name: str
    type: str = "manual"
    dependencies: list[dict[str, Any]] = Field(default_factory=list)
    attrs: list[dict[str, Any]] = Field(default_factory=list)
    items: list[dict[str, Any]] = Field(default_factory=list)
    api_config: dict[str, Any] | None = None


class DictionaryOut(DictionaryIn):
    id: str


# ---- Forms ----
class FormIn(BaseModel):
    form_id: str
    title: str
    grid_columns: int = 2
    fields: list[dict[str, Any]] = Field(default_factory=list)
    submit: dict[str, Any] = Field(default_factory=dict)


class FormOut(FormIn):
    id: str
    version: int
    status: str = "draft"
    published_version: int | None = None
    has_draft_changes: bool = True


# ---- Public ----
class PublicFormOut(BaseModel):
    form_id: str
    title: str
    grid_columns: int
    fields: list[dict[str, Any]]
    submit: dict[str, Any]
    design_tokens: dict[str, Any]
    dictionaries: list[dict[str, Any]]


class SubmitIn(BaseModel):
    data: dict[str, Any]


class ProxyIn(BaseModel):
    endpoint: str
    method: str = "GET"
    params: dict[str, Any] = Field(default_factory=dict)


class ThemeIn(BaseModel):
    design_tokens: dict[str, Any]
    webhook_default: str | None = None
