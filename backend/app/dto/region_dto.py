from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.constants.constants import MAX_SORT_ORDER
from app.enums.geometry_type import GeometryType
from app.enums.region_role import RegionRole
from app.enums.surface_type import SurfaceType


class GeometryPoint(BaseModel):
    x: float = Field(ge=0, le=1, allow_inf_nan=False)
    y: float = Field(ge=0, le=1, allow_inf_nan=False)


class RegionWritePayload(BaseModel):
    id: UUID | None = None
    name: str = Field(min_length=1)
    sort_order: int = Field(default=0, ge=0, le=MAX_SORT_ORDER)
    geometry_type: GeometryType
    geometry_json: list[GeometryPoint]
    surface_type: SurfaceType
    region_role: RegionRole = RegionRole.FINISH
    manual_area_sqft: float | None = Field(
        default=None, ge=0, allow_inf_nan=False
    )
    manual_length_ft: float | None = Field(
        default=None, ge=0, allow_inf_nan=False
    )
    deduction_sqft: float = Field(default=0, ge=0, allow_inf_nan=False)
    material_id: str | None = None
    color_hex: str | None = None
    material_rate_override: float | None = Field(
        default=None, ge=0, allow_inf_nan=False
    )
    labor_rate_override: float | None = Field(
        default=None, ge=0, allow_inf_nan=False
    )

    model_config = ConfigDict(extra="forbid")


class ReplaceRegionsRequest(BaseModel):
    regions: list[RegionWritePayload]

    model_config = ConfigDict(extra="forbid")


class RegionPatchPayload(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    sort_order: int | None = Field(default=None, ge=0, le=MAX_SORT_ORDER)
    geometry_type: GeometryType | None = None
    geometry_json: list[GeometryPoint] | None = None
    surface_type: SurfaceType | None = None
    region_role: RegionRole | None = None
    manual_area_sqft: float | None = Field(
        default=None, ge=0, allow_inf_nan=False
    )
    manual_length_ft: float | None = Field(
        default=None, ge=0, allow_inf_nan=False
    )
    deduction_sqft: float | None = Field(
        default=None, ge=0, allow_inf_nan=False
    )
    material_id: str | None = None
    color_hex: str | None = None
    material_rate_override: float | None = Field(
        default=None, ge=0, allow_inf_nan=False
    )
    labor_rate_override: float | None = Field(
        default=None, ge=0, allow_inf_nan=False
    )

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_required_fields_not_null(self) -> "RegionPatchPayload":
        required_fields = {
            "name",
            "sort_order",
            "geometry_type",
            "geometry_json",
            "surface_type",
            "region_role",
            "deduction_sqft",
        }
        for field in required_fields:
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null.")
        return self


class RegionResponse(BaseModel):
    id: UUID
    image_id: UUID
    name: str
    sort_order: int
    geometry_type: GeometryType
    geometry_json: list[GeometryPoint]
    surface_type: SurfaceType
    region_role: RegionRole
    manual_area_sqft: float | None
    manual_length_ft: float | None
    deduction_sqft: float
    material_id: str | None
    color_hex: str | None
    material_rate_override: float | None
    labor_rate_override: float | None

    model_config = ConfigDict(from_attributes=True)


class RegionListResponse(BaseModel):
    image_id: UUID
    regions: list[RegionResponse]
