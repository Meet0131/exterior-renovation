import logging
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.project import Project
from app.repositories.base_repository import BaseRepository

logger = logging.getLogger(__name__)


class ProjectRepository(BaseRepository[Project]):
    def __init__(self, db: AsyncSession):
        super().__init__(db, Project)

    async def list_with_images(self, limit: int = 20) -> list[Project]:
        logger.debug(f"Fetching recent projects: limit: {limit}")
        stmt = (
            select(Project)
            .options(selectinload(Project.images))
            .order_by(Project.updated_at.desc())
            .limit(limit)
        )
        result = await self.db.execute(stmt)
        projects = list(result.scalars().all())
        logger.debug(f"Recent projects fetched: count: {len(projects)}")
        return projects

    async def get_with_images(self, project_id: UUID) -> Project | None:
        logger.debug(f"Fetching project with images: project_id: {project_id}")
        stmt = (
            select(Project)
            .options(selectinload(Project.images))
            .where(Project.id == project_id)
        )
        result = await self.db.execute(stmt)
        project = result.scalar_one_or_none()
        logger.debug(
            f"Project with images fetch: project_id: {project_id} | "
            f"found: {project is not None}"
        )
        return project
