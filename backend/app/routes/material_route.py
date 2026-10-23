from fastapi import APIRouter, Depends

from app.dependencies.service_dependency import get_material_service
from app.dto.material_dto import MaterialCatalogResponse
from app.services.material_service import MaterialService

router = APIRouter()


@router.get(
    "",
    response_model=MaterialCatalogResponse,
    response_model_exclude_none=True,
)
def list_materials(
    material_service: MaterialService = Depends(get_material_service),
) -> MaterialCatalogResponse:
    return material_service.get_catalog()
