import logging
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Response,
    UploadFile,
    status,
)

from app.config import Config
from app.constants.constants import PDF_MEDIA_TYPE
from app.dependencies.service_dependency import (
    get_estimate_service,
    get_image_service,
    get_project_service,
    get_report_service,
)
from app.dto.estimate_dto import ProjectEstimateResponse
from app.dto.image_dto import ImageUploadResponse
from app.dto.project_dto import (
    CreateProjectRequest,
    ProjectDetailResponse,
    ProjectResponse,
    ProjectSummaryResponse,
    UpdateProjectRequest,
)
from app.services.estimate_service import EstimateService
from app.services.image_service import ImageService
from app.services.project_service import ProjectService
from app.services.report_service import ReportService

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    data: CreateProjectRequest,
    project_service: ProjectService = Depends(get_project_service),
) -> ProjectResponse:
    logger.info("Create project requested")
    response = await project_service.create_project(data)
    logger.info(f"Project created: project_id: {response.id}")
    return response


@router.get("", response_model=list[ProjectSummaryResponse])
async def list_projects(
    project_service: ProjectService = Depends(get_project_service),
) -> list[ProjectSummaryResponse]:
    logger.info("List projects requested")
    response = await project_service.list_projects()
    logger.info(f"Projects listed: count: {len(response)}")
    return response


@router.get("/{project_id}", response_model=ProjectDetailResponse)
async def get_project(
    project_id: UUID,
    project_service: ProjectService = Depends(get_project_service),
) -> ProjectDetailResponse:
    logger.info(f"Get project requested: project_id: {project_id}")
    response = await project_service.get_project(project_id)
    logger.info(
        f"Project fetched: project_id: {response.id} | "
        f"image_count: {len(response.images)}"
    )
    return response


@router.patch("/{project_id}", response_model=ProjectResponse)
async def rename_project(
    project_id: UUID,
    data: UpdateProjectRequest,
    project_service: ProjectService = Depends(get_project_service),
) -> ProjectResponse:
    logger.info(f"Rename project requested: project_id: {project_id}")
    response = await project_service.rename_project(project_id, data)
    logger.info(f"Project renamed: project_id: {response.id}")
    return response


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
    logger.info(
        f"Upload photo requested: project_id: {project_id} | "
        f"content_type: {file.content_type!r}"
    )
    data = await file.read(Config.MAX_UPLOAD_BYTES + 1)
    logger.info(
        f"Upload photo read: project_id: {project_id} | "
        f"size_bytes: {len(data)}"
    )
    response = await image_service.upload_image(project_id, data)
    logger.info(
        f"Photo uploaded: project_id: {project_id} | "
        f"image_id: {response.id} | width: {response.width} | "
        f"height: {response.height} | sort_order: {response.sort_order}"
    )
    return response


@router.get("/{project_id}/estimate", response_model=ProjectEstimateResponse)
async def get_project_estimate(
    project_id: UUID,
    estimate_service: EstimateService = Depends(get_estimate_service),
) -> ProjectEstimateResponse:
    logger.info(f"Project estimate requested: project_id: {project_id}")
    response = await estimate_service.get_project_estimate(project_id)
    logger.info(
        f"Project estimate served: project_id: {project_id} | "
        f"image_count: {len(response.images)} | "
        f"grand_total: {response.grand_total}"
    )
    return response


@router.get("/{project_id}/report.pdf")
async def get_project_report(
    project_id: UUID,
    report_service: ReportService = Depends(get_report_service),
) -> Response:
    logger.info(f"Report requested: project_id: {project_id}")
    report = await report_service.get_project_report(project_id)
    logger.info(
        f"Report served: project_id: {project_id} | "
        f"size_bytes: {len(report.content)}"
    )
    return Response(
        content=report.content,
        media_type=PDF_MEDIA_TYPE,
        headers={
            "Content-Disposition": (
                f'attachment; filename="{report.filename}"'
            ),
            "Cache-Control": "no-store",
        },
    )
