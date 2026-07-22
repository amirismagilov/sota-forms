from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import init_db
from .routers import account, connections, dictionaries, forms, mock, proxy, public, submissions


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Retry DB init briefly so we don't race Postgres at compose startup.
    for attempt in range(30):
        try:
            await init_db()
            break
        except Exception:
            if attempt == 29:
                raise
            await asyncio.sleep(1)
    from .seed import seed_if_empty

    await seed_if_empty()
    yield


app = FastAPI(title="SOTA Forms — universal form builder", version="1.0.0", lifespan=lifespan)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")] if settings.cors_origins != "*" else ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (connections, dictionaries, forms, account, submissions, public, proxy, mock):
    app.include_router(r.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
