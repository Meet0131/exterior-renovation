import logging
from uuid import UUID

from app.dto.region_dto import (
    RegionListResponse,
    RegionPatchPayload,
    RegionResponse,
    RegionWritePayload,
    ReplaceRegionsRequest,
)
from app.enums.geometry_type import GeometryType
from app.enums.region_role import RegionRole
from app.enums.surface_type import SurfaceType
from app.exceptions import ApiError
from app.models.image_region import ImageRegion
from app.repositories.image_region_repository import ImageRegionRepository
from app.repositories.image_repository import ImageRepository
from app.services.material_service import MaterialService
from app.utils.decimal_utils import (
    convert_optional_to_decimal,
    convert_to_decimal,
)
from app.utils.geometry_utils import has_self_intersection

logger = logging.getLogger(__name__)


class RegionService:
    """Reads, replaces and edits the regions drawn on a photo."""

    def __init__(
        self,
        region_repository: ImageRegionRepository,
        image_repository: ImageRepository,
        material_service: MaterialService,
    ):
        self.region_repository = region_repository
        self.image_repository = image_repository
        self.material_service = material_service

    async def get_regions(self, image_id: UUID) -> RegionListResponse:
        logger.debug(f"Get regions started: image_id: {image_id}")
        image = await self.image_repository.get_by_id(image_id)
        if image is None:
            raise ApiError(
                status_code=404,
                code="IMAGE_NOT_FOUND",
                message="Image not found.",
            )

        regions = await self.region_repository.get_for_image(image_id)
        response = RegionListResponse(
            image_id=image_id,
            regions=[
                RegionResponse.model_validate(region) for region in regions
            ],
        )
        logger.debug(
            f"Get regions completed: image_id: {image_id} | "
            f"region_count: {len(response.regions)}"
        )
        return response

    async def replace_regions(
        self, image_id: UUID, data: ReplaceRegionsRequest
    ) -> RegionListResponse:
        logger.info(
            f"Replace regions started: image_id: {image_id} | "
            f"request_region_count: {len(data.regions)}"
        )
        image = await self.image_repository.get_by_id(image_id)
        if image is None:
            raise ApiError(
                status_code=404,
                code="IMAGE_NOT_FOUND",
                message="Image not found.",
            )

        existing = await self.region_repository.get_for_image(image_id)
        existing_by_id = {region.id: region for region in existing}

        await self._validate_replace_ids(data.regions, existing_by_id)
        for index, payload in enumerate(data.regions):
            self._validate_region_payload(payload, f"regions[{index}]")

        visual_changed = self._replace_changes_visuals(existing, data.regions)
        payload_ids = {
            payload.id for payload in data.regions if payload.id is not None
        }
        created_count = sum(
            1 for payload in data.regions if payload.id is None
        )
        updated_count = len(data.regions) - created_count
        deleted_count = sum(
            1 for region in existing if region.id not in payload_ids
        )

        for payload in data.regions:
            if payload.id is None:
                region = ImageRegion(image_id=image_id)
                self._apply_values(region, payload)
                await self.region_repository.save(region)
            else:
                region = existing_by_id[payload.id]
                self._apply_values(region, payload)
                await self.region_repository.save(region)

        for region in existing:
            if region.id not in payload_ids:
                await self.region_repository.delete(region)

        if visual_changed:
            image.final_preview_bytes = None

        await self.region_repository.commit()

        regions = await self.region_repository.get_for_image(image_id)
        response = RegionListResponse(
            image_id=image_id,
            regions=[
                RegionResponse.model_validate(region) for region in regions
            ],
        )
        logger.debug(
            f"Replace regions changes: image_id: {image_id} | "
            f"created: {created_count} | updated: {updated_count} | "
            f"deleted: {deleted_count} | visual_changed: {visual_changed}"
        )
        logger.info(
            f"Replace regions completed: image_id: {image_id} | "
            f"region_count: {len(response.regions)}"
        )
        return response

    async def update_region(
        self, image_id: UUID, region_id: UUID, data: RegionPatchPayload
    ) -> RegionResponse:
        logger.info(
            f"Update region started: image_id: {image_id} | "
            f"region_id: {region_id} | "
            f"fields: {sorted(data.model_fields_set)}"
        )
        region = await self.region_repository.get_by_id(region_id)
        if region is None or region.image_id != image_id:
            raise ApiError(
                status_code=404,
                code="REGION_NOT_FOUND",
                message="Region not found.",
            )

        effective = self._build_patched_payload(region, data)
        material_changed = effective.material_id != region.material_id
        if material_changed:
            if "material_rate_override" not in data.model_fields_set:
                effective.material_rate_override = None
            if "labor_rate_override" not in data.model_fields_set:
                effective.labor_rate_override = None

        self._validate_region_payload(effective, "")
        visual_changed = self._patch_changes_visuals(region, effective)

        self._apply_values(region, effective)
        await self.region_repository.save(region)

        if visual_changed:
            image = await self.image_repository.get_by_id(image_id)
            if image is not None:
                image.final_preview_bytes = None

        await self.region_repository.commit()
        response = RegionResponse.model_validate(region)
        logger.debug(
            f"Update region changes: image_id: {image_id} | "
            f"region_id: {region_id} | material_changed: {material_changed} | "
            f"visual_changed: {visual_changed}"
        )
        logger.info(
            f"Update region completed: image_id: {image_id} | "
            f"region_id: {response.id}"
        )
        return response

    async def _validate_replace_ids(
        self,
        payloads: list[RegionWritePayload],
        existing_by_id: dict[UUID, ImageRegion],
    ) -> None:
        seen_ids: set[UUID] = set()
        for index, payload in enumerate(payloads):
            if payload.id is None:
                continue
            if payload.id in seen_ids:
                raise ApiError(
                    status_code=422,
                    code="VALIDATION_ERROR",
                    message="Region ids must be unique in the request.",
                    field=f"regions[{index}].id",
                )
            seen_ids.add(payload.id)
            if payload.id in existing_by_id:
                continue
            other = await self.region_repository.get_by_id(payload.id)
            if other is not None:
                raise ApiError(
                    status_code=409,
                    code="REGION_ID_CONFLICT",
                    message="This region belongs to another photo.",
                    field=f"regions[{index}].id",
                )
            raise ApiError(
                status_code=422,
                code="VALIDATION_ERROR",
                message="Unknown region id. Omit the id to create a region.",
                field=f"regions[{index}].id",
            )

    def _validate_region_payload(
        self, payload: RegionWritePayload, prefix: str
    ) -> None:
        self._validate_geometry(payload, prefix)
        self._validate_role_and_surface(payload, prefix)
        self._validate_measures(payload, prefix)
        self._validate_material(payload, prefix)

    def _validate_geometry(
        self, payload: RegionWritePayload, prefix: str
    ) -> None:
        points = payload.geometry_json
        field = _field_name(prefix, "geometry_json")

        if payload.geometry_type == GeometryType.POLYGON:
            if len(points) < 3:
                raise ApiError(
                    status_code=422,
                    code="VALIDATION_ERROR",
                    message="A polygon needs at least three points.",
                    field=field,
                )
            if points[0] == points[-1]:
                raise ApiError(
                    status_code=422,
                    code="VALIDATION_ERROR",
                    message=(
                        "A polygon closes automatically; "
                        "remove the repeated first point."
                    ),
                    field=field,
                )
        elif len(points) < 2:
            raise ApiError(
                status_code=422,
                code="VALIDATION_ERROR",
                message="A line needs at least two points.",
                field=field,
            )

        for index in range(len(points) - 1):
            if points[index] == points[index + 1]:
                raise ApiError(
                    status_code=422,
                    code="VALIDATION_ERROR",
                    message="Remove duplicate consecutive points.",
                    field=field,
                )

        if (
            payload.geometry_type == GeometryType.POLYGON
            and has_self_intersection(
                [(point.x, point.y) for point in points]
            )
        ):
            raise ApiError(
                status_code=422,
                code="VALIDATION_ERROR",
                message="The polygon cannot cross itself.",
                field=field,
            )

    def _validate_role_and_surface(
        self, payload: RegionWritePayload, prefix: str
    ) -> None:
        if (
            payload.surface_type in {SurfaceType.WINDOW, SurfaceType.DOOR}
            and payload.region_role != RegionRole.OPENING
        ):
            raise ApiError(
                status_code=422,
                code="VALIDATION_ERROR",
                message="Window and door regions must use the opening role.",
                field=_field_name(prefix, "region_role"),
            )

        if payload.region_role in {RegionRole.OPENING, RegionRole.REFERENCE}:
            if payload.material_id is not None:
                raise ApiError(
                    status_code=422,
                    code="VALIDATION_ERROR",
                    message=(
                        "Opening and reference regions cannot carry a material."
                    ),
                    field=_field_name(prefix, "material_id"),
                )
            if payload.color_hex is not None:
                raise ApiError(
                    status_code=422,
                    code="VALIDATION_ERROR",
                    message=(
                        "Opening and reference regions cannot carry a colour."
                    ),
                    field=_field_name(prefix, "color_hex"),
                )
            if payload.material_rate_override is not None:
                raise ApiError(
                    status_code=422,
                    code="VALIDATION_ERROR",
                    message=(
                        "Opening and reference regions cannot carry "
                        "rate overrides."
                    ),
                    field=_field_name(prefix, "material_rate_override"),
                )
            if payload.labor_rate_override is not None:
                raise ApiError(
                    status_code=422,
                    code="VALIDATION_ERROR",
                    message=(
                        "Opening and reference regions cannot carry "
                        "rate overrides."
                    ),
                    field=_field_name(prefix, "labor_rate_override"),
                )

    def _validate_measures(
        self, payload: RegionWritePayload, prefix: str
    ) -> None:
        if payload.geometry_type == GeometryType.LINE:
            if payload.manual_area_sqft is not None:
                raise ApiError(
                    status_code=422,
                    code="VALIDATION_ERROR",
                    message="A line cannot have a manual area.",
                    field=_field_name(prefix, "manual_area_sqft"),
                )
            if payload.deduction_sqft != 0:
                raise ApiError(
                    status_code=422,
                    code="VALIDATION_ERROR",
                    message="A line cannot have a deduction.",
                    field=_field_name(prefix, "deduction_sqft"),
                )
        if (
            payload.geometry_type == GeometryType.POLYGON
            and payload.manual_length_ft is not None
        ):
            raise ApiError(
                status_code=422,
                code="VALIDATION_ERROR",
                message="A polygon cannot have a manual length.",
                field=_field_name(prefix, "manual_length_ft"),
            )

    def _validate_material(
        self, payload: RegionWritePayload, prefix: str
    ) -> None:
        if payload.material_id is None:
            return

        field = _field_name(prefix, "material_id")
        material = self.material_service.find_material(payload.material_id)
        if material is None:
            raise ApiError(
                status_code=422,
                code="MATERIAL_UNKNOWN",
                message="This material is not available. Choose another material.",
                field=field,
            )
        if payload.surface_type not in material.surfaces:
            raise ApiError(
                status_code=422,
                code="MATERIAL_NOT_APPLICABLE",
                message=(
                    "This material does not apply to that surface. "
                    "Choose another material."
                ),
                field=field,
            )

    def _build_patched_payload(
        self, region: ImageRegion, patch: RegionPatchPayload
    ) -> RegionWritePayload:
        values = {
            "id": region.id,
            "name": region.name,
            "sort_order": region.sort_order,
            "geometry_type": region.geometry_type,
            "geometry_json": region.geometry_json,
            "surface_type": region.surface_type,
            "region_role": region.region_role,
            "manual_area_sqft": region.manual_area_sqft,
            "manual_length_ft": region.manual_length_ft,
            "deduction_sqft": region.deduction_sqft,
            "material_id": region.material_id,
            "color_hex": region.color_hex,
            "material_rate_override": region.material_rate_override,
            "labor_rate_override": region.labor_rate_override,
        }
        values.update(patch.model_dump(exclude_unset=True))
        return RegionWritePayload.model_validate(values)

    def _apply_values(
        self, region: ImageRegion, payload: RegionWritePayload
    ) -> None:
        region.name = payload.name
        region.sort_order = payload.sort_order
        region.geometry_type = payload.geometry_type.value
        region.geometry_json = [
            point.model_dump() for point in payload.geometry_json
        ]
        region.surface_type = payload.surface_type.value
        region.region_role = payload.region_role.value
        region.manual_area_sqft = convert_optional_to_decimal(
            payload.manual_area_sqft, "0.01"
        )
        region.manual_length_ft = convert_optional_to_decimal(
            payload.manual_length_ft, "0.01"
        )
        region.deduction_sqft = convert_to_decimal(
            payload.deduction_sqft, "0.01"
        )
        region.material_id = payload.material_id
        region.color_hex = payload.color_hex
        region.material_rate_override = convert_optional_to_decimal(
            payload.material_rate_override, "0.01"
        )
        region.labor_rate_override = convert_optional_to_decimal(
            payload.labor_rate_override, "0.01"
        )

    def _replace_changes_visuals(
        self,
        existing: list[ImageRegion],
        payloads: list[RegionWritePayload],
    ) -> bool:
        if any(payload.id is None for payload in payloads):
            return True

        existing_by_id = {region.id: region for region in existing}
        payload_ids = {payload.id for payload in payloads}
        if set(existing_by_id) != payload_ids:
            return True

        for payload in payloads:
            region = existing_by_id[payload.id]
            if _visual_values(payload) != _visual_values_from_region(region):
                return True
        return False

    def _patch_changes_visuals(
        self, region: ImageRegion, payload: RegionWritePayload
    ) -> bool:
        return _visual_values(payload) != _visual_values_from_region(region)


def _field_name(prefix: str, name: str) -> str:
    return f"{prefix}.{name}" if prefix else name


def _visual_values_from_region(region: ImageRegion) -> tuple:
    return (
        region.geometry_type,
        region.geometry_json,
        region.surface_type,
        region.region_role,
        region.material_id,
        region.color_hex,
        region.sort_order,
    )


def _visual_values(payload: RegionWritePayload) -> tuple:
    return (
        payload.geometry_type.value,
        [point.model_dump() for point in payload.geometry_json],
        payload.surface_type.value,
        payload.region_role.value,
        payload.material_id,
        payload.color_hex,
        payload.sort_order,
    )
