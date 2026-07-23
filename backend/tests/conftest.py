"""Test fixtures with honest-NA semantics.

GRACE principle: never present unknown as success. Integration tests need a
REAL Postgres (JSONB, upserts, row locks). If none is reachable, the tests are
SKIPPED (marked "not verified"), never silently passed against a fake DB.
"""

from __future__ import annotations

import os

import pytest
import pytest_asyncio

# Point the app at the test database BEFORE importing it.
#
# SAFETY: the `client` fixture DROPS ALL TABLES, so it must NEVER touch the live
# database. We do NOT fall back to DATABASE_URL (that is production) — the default
# is a dedicated `forms_test` DB, and the fixture additionally refuses to run
# against any database whose name doesn't contain "test".
TEST_DB_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://forms:forms@localhost:5432/forms_test",
)
os.environ["DATABASE_URL"] = TEST_DB_URL


def _is_test_db(url: str) -> bool:
    name = url.rsplit("/", 1)[-1].split("?")[0].lower()
    return "test" in name


async def _db_reachable() -> bool:
    from sqlalchemy.ext.asyncio import create_async_engine

    engine = create_async_engine(TEST_DB_URL)
    try:
        async with engine.connect():
            return True
    except Exception:
        return False
    finally:
        await engine.dispose()


@pytest_asyncio.fixture(scope="function")
async def client():
    # Never drop tables on a non-test DB (this fixture wipes the schema).
    if not _is_test_db(TEST_DB_URL):
        pytest.skip(
            f"REFUSING to run: '{TEST_DB_URL}' is not a test database (name must contain 'test'). "
            "Set TEST_DATABASE_URL to a dedicated test DB — the fixture drops all tables."
        )
    if not await _db_reachable():
        pytest.skip(f"HONEST-NA: no Postgres reachable at {TEST_DB_URL} — integration path NOT verified")

    from httpx import ASGITransport, AsyncClient

    from app.db import Base, engine, init_db

    # Fresh schema for isolation.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await init_db()
    from app.seed import seed_if_empty

    await seed_if_empty()

    transport = ASGITransport(app=_get_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        # Authenticate as the seeded demo owner; admin endpoints require it.
        login = await c.post("/api/auth/login", json={"email": "demo@sota.forms", "password": "demo12345"})
        token = login.json()["token"]
        c.headers["Authorization"] = f"Bearer {token}"
        yield c
    await engine.dispose()


def _get_app():
    from app.main import app

    return app
