from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.project import Project
from app.repositories.base_repository import BaseRepository


class ProjectRepository(BaseRepository[Project]):
    def __init__(self, db: AsyncSession):
        super().__init__(db, Project)

    async def get_with_images(self, project_id: UUID) -> Project | None:
        stmt = (
            select(Project)
            .options(selectinload(Project.images))
            .where(Project.id == project_id)
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()
