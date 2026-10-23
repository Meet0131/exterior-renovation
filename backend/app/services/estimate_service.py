from app.repositories.image_calibration_repository import ImageCalibrationRepository
from app.repositories.image_region_repository import ImageRegionRepository
from app.repositories.image_repository import ImageRepository
from app.services.material_service import MaterialService


class EstimateService:
    """Turns geometry, calibration and materials into quantities and costs."""

    def __init__(
        self,
        image_repository: ImageRepository,
        calibration_repository: ImageCalibrationRepository,
        region_repository: ImageRegionRepository,
        material_service: MaterialService,
    ):
        self.image_repository = image_repository
        self.calibration_repository = calibration_repository
        self.region_repository = region_repository
        self.material_service = material_service
