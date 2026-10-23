from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from app.models.image import Image
from app.repositories.base_repository import BaseRepository


class ImageRepository(BaseRepository[Image]):
    def __init__(self, db: AsyncSession):
        super().__init__(db, Image)

    async def get_next_sort_order(self, project_id: UUID) -> int:
        stmt = select(func.coalesce(func.max(Image.sort_order), -1) + 1).where(
            Image.project_id == project_id
        )
        result = await self.db.execute(stmt)
        return result.scalar_one()

    async def get_with_bytes(self, image_id: UUID) -> Image | None:
        stmt = (
            select(Image)
            .options(undefer(Image.bytes))
            .where(Image.id == image_id)
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()
