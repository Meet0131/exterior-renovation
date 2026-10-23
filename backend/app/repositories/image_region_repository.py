from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.image_region import ImageRegion
from app.repositories.base_repository import BaseRepository


class ImageRegionRepository(BaseRepository[ImageRegion]):
    def __init__(self, db: AsyncSession):
        super().__init__(db, ImageRegion)

    async def get_for_image(self, image_id: UUID) -> list[ImageRegion]:
        stmt = (
            select(ImageRegion)
            .where(ImageRegion.image_id == image_id)
            .order_by(ImageRegion.sort_order, ImageRegion.id)
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())
