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
        logger.debug(
            f"Fetching {self.model.__name__}: id: {id}"
        )
        obj = await self.db.get(self.model, id)
        logger.debug(
            f"Fetched {self.model.__name__}: id: {id} | "
            f"found: {obj is not None}"
        )
        return obj

    async def save(self, obj: T) -> T:
        """Insert a new record. Use when the record is known not to exist."""
        self.db.add(obj)
        await self.db.flush()
        logger.debug(
            f"Saved {self.model.__name__}: "
            f"id: {getattr(obj, 'id', None)}"
        )
        return obj

    async def save_all(self, objs: list[T]) -> list[T]:
        self.db.add_all(objs)
        await self.db.flush()
        logger.debug(
            f"Saved {self.model.__name__}: count: {len(objs)}"
        )
        return objs

    async def save_and_commit(self, obj: T) -> T:
        await self.save(obj)
        await self.db.commit()
        logger.debug(
            f"Saved and committed {self.model.__name__}: "
            f"id: {getattr(obj, 'id', None)}"
        )
        return obj

    async def upsert(self, obj: T) -> T:
        """Insert or update a record based on its primary key."""
        merged_obj = await self.db.merge(obj)
        await self.db.commit()
        logger.debug(
            f"Upserted {self.model.__name__}: "
            f"id: {getattr(merged_obj, 'id', None)}"
        )
        return merged_obj

    async def save_and_refresh(self, obj: T) -> T:
        self.db.add(obj)
        await self.db.commit()
        await self.db.refresh(obj)
        logger.debug(
            f"Saved and refreshed {self.model.__name__}: "
            f"id: {getattr(obj, 'id', None)}"
        )
        return obj

    async def delete(self, obj: T) -> None:
        object_id = getattr(obj, "id", None)
        await self.db.delete(obj)
        await self.db.flush()
        logger.debug(
            f"Deleted {self.model.__name__}: id: {object_id}"
        )

    async def commit(self) -> None:
        logger.debug("Committing transaction")
        await self.db.commit()

    async def rollback(self) -> None:
        logger.debug("Rolling back transaction")
        await self.db.rollback()

    def expire_all(self) -> None:
        logger.debug("Expiring all loaded objects")
        self.db.expire_all()
