from functools import cached_property

from app.di.repository_container import RepositoryContainer
from app.services.calibration_service import CalibrationService
from app.services.detection_service import DetectionService
from app.services.estimate_service import EstimateService
from app.services.image_service import ImageService
from app.services.image_upload_service import ImageUploadService
from app.services.material_service import MaterialService
from app.services.project_service import ProjectService
from app.services.region_service import RegionService
from app.services.report_service import ReportService


class ServiceContainer:
    def __init__(self, repository_container: RepositoryContainer):
        self.repository_container = repository_container

    @cached_property
    def project_service(self) -> ProjectService:
        return ProjectService(self.repository_container.project_repository)

    @cached_property
    def calibration_service(self) -> CalibrationService:
        return CalibrationService(
            self.repository_container.calibration_repository,
            self.repository_container.image_repository,
        )

    @cached_property
    def image_upload_service(self) -> ImageUploadService:
        return ImageUploadService()

    @cached_property
    def image_service(self) -> ImageService:
        return ImageService(
            self.repository_container.image_repository,
            self.repository_container.project_repository,
            self.image_upload_service,
            self.calibration_service,
        )

    @cached_property
    def material_service(self) -> MaterialService:
        return MaterialService()

    @cached_property
    def region_service(self) -> RegionService:
        return RegionService(
            self.repository_container.region_repository,
            self.repository_container.image_repository,
            self.material_service,
        )

    @cached_property
    def detection_service(self) -> DetectionService:
        return DetectionService(self.repository_container.image_repository)

    @cached_property
    def estimate_service(self) -> EstimateService:
        return EstimateService(
            self.repository_container.image_repository,
            self.repository_container.calibration_repository,
            self.repository_container.region_repository,
            self.material_service,
        )

    @cached_property
    def report_service(self) -> ReportService:
        return ReportService(
            self.repository_container.project_repository,
            self.repository_container.image_repository,
            self.estimate_service,
        )
