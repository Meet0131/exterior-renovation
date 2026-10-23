from functools import cached_property

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.image_calibration_repository import ImageCalibrationRepository
from app.repositories.image_region_repository import ImageRegionRepository
from app.repositories.image_repository import ImageRepository
from app.repositories.project_repository import ProjectRepository


class RepositoryContainer:
    def __init__(self, db: AsyncSession):
        self.db = db

    @cached_property
    def project_repository(self) -> ProjectRepository:
        return ProjectRepository(self.db)

    @cached_property
    def image_repository(self) -> ImageRepository:
        return ImageRepository(self.db)

    @cached_property
    def calibration_repository(self) -> ImageCalibrationRepository:
        return ImageCalibrationRepository(self.db)

    @cached_property
    def region_repository(self) -> ImageRegionRepository:
        return ImageRegionRepository(self.db)
