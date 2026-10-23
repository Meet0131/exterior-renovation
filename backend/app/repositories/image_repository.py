import logging
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, undefer

from app.models.image import Image
from app.repositories.base_repository import BaseRepository

logger = logging.getLogger(__name__)


class ImageRepository(BaseRepository[Image]):
    def __init__(self, db: AsyncSession):
        super().__init__(db, Image)

    async def get_next_sort_order(self, project_id: UUID) -> int:
        logger.debug(f"Finding next image sort order: project_id: {project_id}")
        stmt = select(func.coalesce(func.max(Image.sort_order), -1) + 1).where(
            Image.project_id == project_id
        )
        result = await self.db.execute(stmt)
        sort_order = result.scalar_one()
        logger.debug(
            f"Next image sort order: project_id: {project_id} | "
            f"sort_order: {sort_order}"
        )
        return sort_order

    async def count_images_for_project(self, project_id: UUID) -> int:
        stmt = (
            select(func.count())
            .select_from(Image)
            .where(Image.project_id == project_id)
        )
        result = await self.db.execute(stmt)
        count = result.scalar_one()
        logger.debug(
            f"Counted project images: project_id: {project_id} | "
            f"count: {count}"
        )
        return count

    async def get_with_bytes(self, image_id: UUID) -> Image | None:
        logger.debug(f"Fetching image bytes: image_id: {image_id}")
        stmt = (
            select(Image)
            .options(undefer(Image.bytes))
            .where(Image.id == image_id)
        )
        result = await self.db.execute(stmt)
        image = result.scalar_one_or_none()
        logger.debug(
            f"Image bytes fetch: image_id: {image_id} | "
            f"found: {image is not None}"
        )
        return image

    async def get_with_final_preview(self, image_id: UUID) -> Image | None:
        logger.debug(f"Fetching final preview: image_id: {image_id}")
        stmt = (
            select(Image)
            .options(undefer(Image.final_preview_bytes))
            .where(Image.id == image_id)
        )
        result = await self.db.execute(stmt)
        image = result.scalar_one_or_none()
        logger.debug(
            f"Final preview fetch: image_id: {image_id} | "
            f"found: {image is not None}"
        )
        return image

    async def get_for_project_with_estimate_data(
        self, project_id: UUID
    ) -> list[Image]:
        logger.debug(
            f"Fetching project estimate data: project_id: {project_id}"
        )
        stmt = (
            select(Image)
            .options(
                selectinload(Image.calibration),
                selectinload(Image.regions),
            )
            .where(Image.project_id == project_id)
            .order_by(Image.sort_order, Image.id)
        )
        result = await self.db.execute(stmt)
        images = list(result.scalars().all())
        logger.debug(
            f"Project estimate data fetch: project_id: {project_id} | "
            f"count: {len(images)}"
        )
        return images

    async def get_for_project_with_report_data(
        self, project_id: UUID
    ) -> list[Image]:
        logger.debug(
            f"Fetching project report data: project_id: {project_id}"
        )
        stmt = (
            select(Image)
            .options(
                undefer(Image.bytes),
                undefer(Image.final_preview_bytes),
                selectinload(Image.calibration),
                selectinload(Image.regions),
            )
            .where(Image.project_id == project_id)
            .order_by(Image.sort_order, Image.id)
        )
        result = await self.db.execute(stmt)
        images = list(result.scalars().all())
        logger.debug(
            f"Project report data fetch: project_id: {project_id} | "
            f"count: {len(images)}"
        )
        return images
