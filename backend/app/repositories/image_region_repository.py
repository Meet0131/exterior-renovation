import logging
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.image_region import ImageRegion
from app.repositories.base_repository import BaseRepository

logger = logging.getLogger(__name__)


class ImageRegionRepository(BaseRepository[ImageRegion]):
    def __init__(self, db: AsyncSession):
        super().__init__(db, ImageRegion)

    async def get_for_image(self, image_id: UUID) -> list[ImageRegion]:
        logger.debug(f"Fetching image regions: image_id: {image_id}")
        stmt = (
            select(ImageRegion)
            .where(ImageRegion.image_id == image_id)
            .order_by(ImageRegion.sort_order, ImageRegion.id)
        )
        result = await self.db.execute(stmt)
        regions = list(result.scalars().all())
        logger.debug(
            f"Image regions fetch: image_id: {image_id} | "
            f"count: {len(regions)}"
        )
        return regions
