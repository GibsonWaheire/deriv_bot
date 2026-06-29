"""
Async SQLAlchemy engine and session factory.
Uses psycopg3 (psycopg) async driver.
"""
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

# Convert postgresql:// → postgresql+psycopg:// for async psycopg3 driver
_url = settings.database_url.replace("postgresql://", "postgresql+psycopg://", 1)

engine = create_async_engine(_url, echo=False, pool_pre_ping=True)

AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    """FastAPI dependency — yields an async DB session."""
    async with AsyncSessionLocal() as session:
        yield session
