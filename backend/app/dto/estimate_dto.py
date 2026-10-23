from uuid import UUID

from pydantic import BaseModel


class EstimateLineResponse(BaseModel):
    region_id: UUID
    region_name: str
    material_name: str
    final_measure: float
    measure_unit: str
    waste_pct: float
    purchase_qty: float
    purchase_unit: str
    material_rate: float
    labor_rate: float
    material_cost: float
    labor_cost: float
    line_total: float


class ImageEstimateResponse(BaseModel):
    contingency_pct: float
    lines: list[EstimateLineResponse]
    subtotal_material: float
    subtotal_labor: float
    contingency: float
    grand_total: float


class ProjectImageEstimateResponse(BaseModel):
    image_id: UUID
    subtotal_material: float
    subtotal_labor: float


class ProjectEstimateResponse(BaseModel):
    contingency_pct: float
    images: list[ProjectImageEstimateResponse]
    subtotal_material: float
    subtotal_labor: float
    contingency: float
    grand_total: float
