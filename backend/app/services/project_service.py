from uuid import UUID

from app.constants.constants import DEFAULT_PROJECT_TITLE
from app.dto.project_dto import (
    CreateProjectRequest,
    ProjectDetailResponse,
    ProjectResponse,
    UpdateProjectRequest,
)
from app.exceptions import ApiError
from app.models.project import Project
from app.repositories.project_repository import ProjectRepository
from app.utils.time_utils import utc_now


class ProjectService:
    """Project creation, reads and renames."""

    def __init__(self, project_repository: ProjectRepository):
        self.project_repository = project_repository

    async def create_project(self, data: CreateProjectRequest) -> ProjectResponse:
        project = Project(title=data.title or DEFAULT_PROJECT_TITLE)
        await self.project_repository.save_and_commit(project)
        return ProjectResponse.model_validate(project)

    async def get_project(self, project_id: UUID) -> ProjectDetailResponse:
        project = await self.project_repository.get_with_images(project_id)
        if project is None:
            raise ApiError(
                status_code=404,
                code="PROJECT_NOT_FOUND",
                message="Project not found.",
            )
        return ProjectDetailResponse.model_validate(project)

    async def rename_project(
        self, project_id: UUID, data: UpdateProjectRequest
    ) -> ProjectResponse:
        project = await self.project_repository.get_by_id(project_id)
        if project is None:
            raise ApiError(
                status_code=404,
                code="PROJECT_NOT_FOUND",
                message="Project not found.",
            )
        project.title = data.title
        project.updated_at = utc_now()
        await self.project_repository.save_and_refresh(project)
        return ProjectResponse.model_validate(project)
