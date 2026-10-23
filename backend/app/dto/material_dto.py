from pydantic import BaseModel, ConfigDict, Field, PositiveInt

from app.enums.surface_type import SurfaceType


class MaterialResponse(BaseModel):
    id: str
    name: str
    category: str
    unit: str
    surfaces: list[SurfaceType]
    coverage_per_unit: int | float = Field(gt=0)
    coats: int = Field(default=1, ge=1)
    pack_sizes: list[PositiveInt] | None = None
    waste_pct: int | float = Field(ge=0)
    material_rate: float = Field(ge=0)
    labor_rate: float = Field(ge=0)
    labor_unit: str
    colors: list[str]
    texture: str

    model_config = ConfigDict(extra="forbid")


class MaterialCatalogResponse(BaseModel):
    materials: list[MaterialResponse]

    model_config = ConfigDict(extra="forbid")
