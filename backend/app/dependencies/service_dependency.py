from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.di.repository_container import RepositoryContainer
from app.di.service_container import ServiceContainer
from app.services.calibration_service import CalibrationService
from app.services.detection_service import DetectionService
from app.services.estimate_service import EstimateService
from app.services.image_service import ImageService
from app.services.material_service import MaterialService
from app.services.project_service import ProjectService
from app.services.region_service import RegionService
from app.services.report_service import ReportService


def get_repository_container(
    db: AsyncSession = Depends(get_db),
) -> RepositoryContainer:
    return RepositoryContainer(db)


def get_container(
    repository_container: RepositoryContainer = Depends(get_repository_container),
) -> ServiceContainer:
    return ServiceContainer(repository_container)


def get_project_service(
    container: ServiceContainer = Depends(get_container),
) -> ProjectService:
    return container.project_service


def get_image_service(
    container: ServiceContainer = Depends(get_container),
) -> ImageService:
    return container.image_service


def get_calibration_service(
    container: ServiceContainer = Depends(get_container),
) -> CalibrationService:
    return container.calibration_service


def get_region_service(
    container: ServiceContainer = Depends(get_container),
) -> RegionService:
    return container.region_service


def get_material_service(
    container: ServiceContainer = Depends(get_container),
) -> MaterialService:
    return container.material_service


def get_detection_service(
    container: ServiceContainer = Depends(get_container),
) -> DetectionService:
    return container.detection_service


def get_estimate_service(
    container: ServiceContainer = Depends(get_container),
) -> EstimateService:
    return container.estimate_service


def get_report_service(
    container: ServiceContainer = Depends(get_container),
) -> ReportService:
    return container.report_service
