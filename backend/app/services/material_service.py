import logging
from pathlib import Path

from app.dto.material_dto import MaterialCatalogResponse, MaterialResponse

logger = logging.getLogger(__name__)

MATERIALS_DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "materials.json"


class MaterialService:
    """Serves the static material catalog and looks up materials by id."""

    def get_catalog(self) -> MaterialCatalogResponse:
        logger.debug(
            f"Returning material catalog: count: {len(_CATALOG.materials)}"
        )
        return _CATALOG

    def find_material(self, material_id: str) -> MaterialResponse | None:
        material = _MATERIALS_BY_ID.get(material_id)
        logger.debug(
            f"Find material: material_id: {material_id!r} | "
            f"found: {material is not None}"
        )
        return material


def _load_catalog() -> MaterialCatalogResponse:
    catalog = MaterialCatalogResponse.model_validate_json(
        MATERIALS_DATA_PATH.read_text(encoding="utf-8")
    )
    _validate_unique_material_ids(catalog.materials)
    return catalog


def _validate_unique_material_ids(materials: list[MaterialResponse]) -> None:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for material in materials:
        if material.id in seen:
            duplicates.add(material.id)
        seen.add(material.id)
    if duplicates:
        raise ValueError(
            f"Duplicate material ids in catalog: {sorted(duplicates)}"
        )


_CATALOG = _load_catalog()
_MATERIALS_BY_ID = {material.id: material for material in _CATALOG.materials}
