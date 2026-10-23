from sqlalchemy.ext.asyncio import AsyncSession

from app.models.image_calibration import ImageCalibration
from app.repositories.base_repository import BaseRepository


class ImageCalibrationRepository(BaseRepository[ImageCalibration]):
    def __init__(self, db: AsyncSession):
        super().__init__(db, ImageCalibration)
