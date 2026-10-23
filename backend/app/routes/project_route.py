from uuid import UUID

from fastapi import APIRouter, Depends, File, UploadFile, status

from app.config import settings
from app.dependencies.service_dependency import get_image_service, get_project_service
from app.dto.image_dto import ImageUploadResponse
from app.dto.project_dto import (
    CreateProjectRequest,
    ProjectDetailResponse,
    ProjectResponse,
    UpdateProjectRequest,
)
from app.services.image_service import ImageService
from app.services.project_service import ProjectService

router = APIRouter()


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    data: CreateProjectRequest,
    project_service: ProjectService = Depends(get_project_service),
) -> ProjectResponse:
    return await project_service.create_project(data)


@router.get("/{project_id}", response_model=ProjectDetailResponse)
async def get_project(
    project_id: UUID,
    project_service: ProjectService = Depends(get_project_service),
) -> ProjectDetailResponse:
    return await project_service.get_project(project_id)


@router.patch("/{project_id}", response_model=ProjectResponse)
async def rename_project(
    project_id: UUID,
    data: UpdateProjectRequest,
    project_service: ProjectService = Depends(get_project_service),
) -> ProjectResponse:
    return await project_service.rename_project(project_id, data)


@router.post(
    "/{project_id}/images",
    response_model=ImageUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_project_image(
    project_id: UUID,
    file: UploadFile = File(...),
    image_service: ImageService = Depends(get_image_service),
) -> ImageUploadResponse:
    data = await file.read(settings.max_upload_bytes + 1)
    return await image_service.upload_image(project_id, data)


# Planned endpoints (not implemented yet):
# GET    /projects/{project_id}/estimate
# GET    /projects/{project_id}/report.pdf
