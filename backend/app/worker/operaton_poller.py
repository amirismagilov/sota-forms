"""Background loop that keeps the registry in step with the sota-bpmn catalogue.

Deploy a process in sota-bpmn — its generated forms appear here on the next pass,
without anyone pressing «Загрузить все».

Polling rather than a webhook from sota-bpmn, deliberately:

* it catches forms however they were deployed (agent pipeline, Cockpit, by hand),
  not only the one code path that would call a hook;
* it needs no inbound endpoint on this side and no credentials on that side;
* `sync_account` is idempotent, so a missed or repeated pass costs nothing.

The trade is latency — up to `operaton_sync_interval` seconds. That is fine for
design-time artefacts: nobody deploys a process and expects the form one second
later, and the manual button is still there for exactly that case.
"""

from __future__ import annotations

import asyncio

from ..config import get_settings
from ..db import SessionLocal
from ..operaton_sync import sync_account


def _target_account() -> str:
    s = get_settings()
    return s.operaton_sync_account or s.default_account_id


async def run_once() -> dict:
    """One pass. Never raises — the loop must survive a dead sota-bpmn."""
    settings = get_settings()
    async with SessionLocal() as db:
        return await sync_account(
            db,
            _target_account(),
            publish=settings.operaton_sync_publish,
            user_id="auto-sync",
            note="Автосинхронизация с Оператоном",
        )


async def run() -> None:
    settings = get_settings()
    if not settings.operaton_auto_sync:
        return
    if not (settings.sota_bpmn_base or "").strip():
        print("[operaton-sync] OPERATON_AUTO_SYNC is on but SOTA_BPMN_BASE is empty — not starting", flush=True)
        return

    interval = max(30, settings.operaton_sync_interval)
    print(
        f"[operaton-sync] watching sota-bpmn every {interval}s "
        f"→ account {_target_account()}, publish={settings.operaton_sync_publish}",
        flush=True,
    )
    while True:
        try:
            res = await run_once()
            if res.get("imported"):
                names = ", ".join(i.get("form_id", "?") for i in res["items"] if i["status"] == "imported")
                print(f"[operaton-sync] imported {res['imported']}: {names}", flush=True)
            if res.get("failed"):
                for i in res["items"]:
                    if i["status"] == "failed":
                        print(f"[operaton-sync] FAILED {i['operaton_form_id']}: {i.get('detail')}", flush=True)
        except Exception as exc:  # sota-bpmn down, DB blip — try again next pass
            print(f"[operaton-sync] pass failed: {exc}", flush=True)
        await asyncio.sleep(interval)
