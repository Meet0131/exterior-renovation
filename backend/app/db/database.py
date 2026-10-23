import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import Config
from app.exceptions import ApiError

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


engine = create_async_engine(
    Config.DATABASE_URL,
    echo=Config.DATABASE_ECHO,
    pool_pre_ping=True,
    pool_size=Config.DATABASE_POOL_SIZE,
    max_overflow=Config.DATABASE_MAX_OVERFLOW,
    pool_timeout=Config.DATABASE_POOL_TIMEOUT,
    pool_recycle=Config.DATABASE_POOL_RECYCLE,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    autoflush=False,
    expire_on_commit=False,
)


@asynccontextmanager
async def db_session_manager() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            logger.debug("DB session opened")
            yield session
            await session.commit()
            logger.debug("DB session committed")
        except (ApiError, RequestValidationError) as exc:
            await session.rollback()
            logger.debug(
                f"DB session rolled back: error_type: {type(exc).__name__}"
            )
            raise
        except SQLAlchemyError:
            await session.rollback()
            logger.exception("Database error during DB session")
            raise
        except Exception:
            await session.rollback()
            logger.exception("Unexpected error during DB session")
            raise


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with db_session_manager() as session:
        yield session
