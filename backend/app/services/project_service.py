import logging
from uuid import UUID

from app.constants.constants import DEFAULT_PROJECT_TITLE
from app.dto.project_dto import (
    CreateProjectRequest,
    ProjectDetailResponse,
    ProjectResponse,
    ProjectSummaryResponse,
    UpdateProjectRequest,
)
from app.exceptions import ApiError
from app.models.project import Project
from app.repositories.project_repository import ProjectRepository
from app.utils.time_utils import utc_now

logger = logging.getLogger(__name__)


class ProjectService:
    """Project creation, reads and renames."""

    def __init__(self, project_repository: ProjectRepository):
        self.project_repository = project_repository

    async def create_project(self, data: CreateProjectRequest) -> ProjectResponse:
        logger.info(
            f"Create project started: title_provided: {data.title is not None}"
        )
        project = Project(title=data.title or DEFAULT_PROJECT_TITLE)
        await self.project_repository.save_and_commit(project)
        response = ProjectResponse.model_validate(project)
        logger.info(f"Create project completed: project_id: {response.id}")
        return response

    async def list_projects(self) -> list[ProjectSummaryResponse]:
        logger.debug("List projects started")
        projects = await self.project_repository.list_with_images()
        response = [
            ProjectSummaryResponse(
                id=project.id,
                title=project.title,
                created_at=project.created_at,
                updated_at=project.updated_at,
                image_count=len(project.images),
                cover_image_id=(
                    project.images[0].id if project.images else None
                ),
            )
            for project in projects
        ]
        logger.debug(f"List projects completed: count: {len(response)}")
        return response

    async def get_project(self, project_id: UUID) -> ProjectDetailResponse:
        logger.debug(f"Get project started: project_id: {project_id}")
        project = await self.project_repository.get_with_images(project_id)
        if project is None:
            raise ApiError(
                status_code=404,
                code="PROJECT_NOT_FOUND",
                message="Project not found.",
            )
        response = ProjectDetailResponse.model_validate(project)
        logger.debug(
            f"Get project completed: project_id: {project_id} | "
            f"image_count: {len(response.images)}"
        )
        return response

    async def rename_project(
        self, project_id: UUID, data: UpdateProjectRequest
    ) -> ProjectResponse:
        logger.info(f"Rename project started: project_id: {project_id}")
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
        response = ProjectResponse.model_validate(project)
        logger.info(f"Rename project completed: project_id: {project_id}")
        return response
