from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import get_settings

settings = get_settings()

engine = create_async_engine(settings.database_url, echo=False, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session


# create_all only creates MISSING tables — it never adds columns to a table that
# already exists. These idempotent patches carry existing databases forward.
_COLUMN_PATCHES = (
    "ALTER TABLE forms ADD COLUMN IF NOT EXISTS source VARCHAR NOT NULL DEFAULT 'local'",
    "ALTER TABLE forms ADD COLUMN IF NOT EXISTS source_meta JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE forms ADD COLUMN IF NOT EXISTS source_schema JSONB",
    "CREATE INDEX IF NOT EXISTS ix_forms_source ON forms (source)",
)


async def init_db() -> None:
    # Import models so they register on the metadata before create_all.
    from . import models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for stmt in _COLUMN_PATCHES:
            await conn.exec_driver_sql(stmt)
