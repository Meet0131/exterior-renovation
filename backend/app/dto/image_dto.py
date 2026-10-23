from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.constants.constants import MAX_SORT_ORDER
from app.dto.calibration_dto import CalibrationPayload


class ImageUploadResponse(BaseModel):
    id: UUID
    project_id: UUID
    sort_order: int
    width: int
    height: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UpdateImageRequest(BaseModel):
    sort_order: int | None = Field(
        default=None, ge=0, le=MAX_SORT_ORDER
    )
    calibration: CalibrationPayload | None = None

    model_config = ConfigDict(extra="forbid")


class ImageUpdateResponse(ImageUploadResponse):
    calibration: CalibrationPayload | None


class FinalizeResponse(BaseModel):
    image_id: UUID
    stored: bool
    width: int
    height: int
    size_bytes: int


@dataclass(frozen=True)
class SourceImage:
    id: UUID
    content: bytes


@dataclass(frozen=True)
class FinalPreview:
    id: UUID
    content: bytes
