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
    # Optional JSON body for non-GET probes (e.g. DaData /suggest/address).
    body: dict | None = None


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
    source: str = "local"
    source_meta: dict[str, Any] = Field(default_factory=dict)


# ---- Operaton import ----
class OperatonImportIn(BaseModel):
    """Import a form either by pulling it from sota-bpmn or from an uploaded file.

    Exactly one of `schema` (raw form-js JSON) or `operaton_form_id` must be set.
    """

    schema_: dict[str, Any] | None = Field(default=None, alias="schema")
    operaton_form_id: str | None = None
    process_key: str | None = None
    form_id: str | None = None
    title: str | None = None

    model_config = {"populate_by_name": True}


# ---- Public ----
class PublicFormOut(BaseModel):
    form_id: str
    title: str
    grid_columns: int
    fields: list[dict[str, Any]]
    submit: dict[str, Any]
    design_tokens: dict[str, Any]
    dictionaries: list[dict[str, Any]]
    source: str = "local"
    # Operaton process variable name → our field id (empty for local forms).
    key_map: dict[str, str] = Field(default_factory=dict)


class SubmitIn(BaseModel):
    data: dict[str, Any]
    # Runtime context supplied by the embedding host, e.g. {"taskId": "..."} for
    # an Operaton user task. Feeds the {{placeholders}} of the webhook URL.
    context: dict[str, Any] = Field(default_factory=dict)
    # Which step of the submit flow is being sent. Empty = the first one.
    step: str | None = None
    # Continuation of a multi-step flow: both come from the previous step's
    # response and are verified together (see crypto.sign_flow_token).
    submissionId: str | None = None
    flowToken: str | None = None


class FlowTestIn(BaseModel):
    """«Тест ответа» в конструкторе: прогон правил шага по образцу ответа.

    Работает по ЧЕРНОВИКУ, а не по опубликованной версии — иначе нельзя было бы
    проверить правило до публикации, ради которой его и настраивают.
    """

    step: str | None = None
    status: int = 200
    response: Any = None
    data: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None


class ProxyIn(BaseModel):
    endpoint: str
    method: str = "GET"
    params: dict[str, Any] = Field(default_factory=dict)


class ThemeIn(BaseModel):
    design_tokens: dict[str, Any]
    webhook_default: str | None = None
