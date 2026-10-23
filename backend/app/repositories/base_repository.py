import logging
from typing import Generic, TypeVar
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import Base

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=Base)


class BaseRepository(Generic[T]):
    def __init__(self, db: AsyncSession, model: type[T]):
        self.db = db
        self.model = model

    async def get_by_id(self, id: UUID) -> T | None:
        logger.debug("Fetching %s with id=%s", self.model.__name__, id)
        return await self.db.get(self.model, id)

    async def save(self, obj: T) -> T:
        """Insert a new record. Use when the record is known not to exist."""
        logger.debug("Saving %s object", self.model.__name__)
        self.db.add(obj)
        await self.db.flush()
        return obj

    async def save_all(self, objs: list[T]) -> list[T]:
        logger.debug("Saving %s %s objects", len(objs), self.model.__name__)
        self.db.add_all(objs)
        await self.db.flush()
        return objs

    async def save_and_commit(self, obj: T) -> T:
        logger.debug("Saving and committing %s object", self.model.__name__)
        await self.save(obj)
        await self.db.commit()
        return obj

    async def upsert(self, obj: T) -> T:
        """Insert or update a record based on its primary key."""
        logger.debug("Upserting %s object", self.model.__name__)
        merged_obj = await self.db.merge(obj)
        await self.db.commit()
        return merged_obj

    async def save_and_refresh(self, obj: T) -> T:
        logger.debug("Saving and refreshing %s object", self.model.__name__)
        self.db.add(obj)
        await self.db.commit()
        await self.db.refresh(obj)
        return obj

    async def delete(self, obj: T) -> None:
        logger.debug("Deleting %s object", self.model.__name__)
        await self.db.delete(obj)
        await self.db.flush()

    async def commit(self) -> None:
        logger.debug("Committing transaction")
        await self.db.commit()

    async def rollback(self) -> None:
        logger.debug("Rolling back transaction")
        await self.db.rollback()

    def expire_all(self) -> None:
        logger.debug("Expiring all loaded objects")
        self.db.expire_all()
