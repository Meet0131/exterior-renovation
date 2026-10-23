from uuid import UUID

from app.dto.calibration_dto import CalibrationPayload, CalibrationResponse
from app.exceptions import ApiError
from app.models.image_calibration import ImageCalibration
from app.repositories.image_calibration_repository import ImageCalibrationRepository
from app.repositories.image_repository import ImageRepository
from app.utils.decimal_utils import convert_to_decimal


class CalibrationService:
    """Reads and writes the reference length for a photo."""

    def __init__(
        self,
        calibration_repository: ImageCalibrationRepository,
        image_repository: ImageRepository,
    ):
        self.calibration_repository = calibration_repository
        self.image_repository = image_repository

    async def get_calibration_response(self, image_id: UUID) -> CalibrationResponse:
        image = await self.image_repository.get_by_id(image_id)
        if image is None:
            raise ApiError(
                status_code=404,
                code="IMAGE_NOT_FOUND",
                message="Image not found.",
            )

        calibration = await self.find_calibration(image_id)
        if calibration is None:
            raise ApiError(
                status_code=404,
                code="CALIBRATION_NOT_FOUND",
                message="This photo has no saved scale. Set a known length first.",
            )
        return CalibrationResponse.model_validate(calibration)

    async def find_calibration(
        self, image_id: UUID
    ) -> ImageCalibration | None:
        return await self.calibration_repository.get_by_id(image_id)

    async def set_calibration(
        self, image_id: UUID, calibration: CalibrationPayload | None
    ) -> ImageCalibration | None:
        """Create, replace, or delete (when calibration is None) the saved scale."""
        existing = await self.find_calibration(image_id)
        if calibration is None:
            if existing is not None:
                await self.calibration_repository.delete(existing)
            return None

        if existing is None:
            existing = ImageCalibration(image_id=image_id)

        existing.length_ft = convert_to_decimal(calibration.length_ft, "0.01")
        existing.p1_x = convert_to_decimal(calibration.p1_x, "0.00001")
        existing.p1_y = convert_to_decimal(calibration.p1_y, "0.00001")
        existing.p2_x = convert_to_decimal(calibration.p2_x, "0.00001")
        existing.p2_y = convert_to_decimal(calibration.p2_y, "0.00001")

        await self.calibration_repository.save(existing)
        return existing
