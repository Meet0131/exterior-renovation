from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.dto.region_dto import GeometryPoint
from app.enums.geometry_type import GeometryType
from app.enums.region_role import RegionRole
from app.enums.surface_type import SurfaceType


class DetectedRegionSuggestion(BaseModel):
    name: str
    geometry_type: GeometryType
    geometry_json: list[GeometryPoint]
    surface_type: SurfaceType
    region_role: RegionRole
    confidence: float = Field(ge=0, le=1, allow_inf_nan=False)

    model_config = ConfigDict(extra="forbid")


class DetectionSnapshot(BaseModel):
    detected_at: datetime
    suggestions: list[DetectedRegionSuggestion]

    model_config = ConfigDict(extra="forbid")


class DetectionResponse(BaseModel):
    image_id: UUID
    suggestions: list[DetectedRegionSuggestion]
    detected_at: datetime
    cached: bool
    truncated: bool
