from uuid import UUID

from fastapi import APIRouter, Depends, Response

from app.constants.constants import (
    IMMUTABLE_IMAGE_CACHE_CONTROL,
    WEBP_MEDIA_TYPE,
)
from app.dependencies.service_dependency import (
    get_calibration_service,
    get_detection_service,
    get_image_service,
    get_region_service,
)
from app.dto.calibration_dto import CalibrationResponse
from app.dto.detection_dto import DetectionResponse
from app.dto.image_dto import ImageUpdateResponse, UpdateImageRequest
from app.dto.region_dto import (
    RegionListResponse,
    RegionPatchPayload,
    RegionResponse,
    ReplaceRegionsRequest,
)
from app.services.calibration_service import CalibrationService
from app.services.detection_service import DetectionService
from app.services.image_service import ImageService
from app.services.region_service import RegionService

router = APIRouter()


@router.get("/{image_id}")
async def get_source_image(
    image_id: UUID,
    image_service: ImageService = Depends(get_image_service),
) -> Response:
    image = await image_service.get_source_image(image_id)
    return Response(
        content=image.content,
        media_type=WEBP_MEDIA_TYPE,
        headers={
            "ETag": f'"{image.id}"',
            "Cache-Control": IMMUTABLE_IMAGE_CACHE_CONTROL,
        },
    )


@router.patch("/{image_id}", response_model=ImageUpdateResponse)
async def update_image(
    image_id: UUID,
    data: UpdateImageRequest,
    image_service: ImageService = Depends(get_image_service),
) -> ImageUpdateResponse:
    return await image_service.update_image(image_id, data)


@router.get("/{image_id}/calibration", response_model=CalibrationResponse)
async def get_calibration(
    image_id: UUID,
    calibration_service: CalibrationService = Depends(get_calibration_service),
) -> CalibrationResponse:
    return await calibration_service.get_calibration_response(image_id)


@router.get("/{image_id}/regions", response_model=RegionListResponse)
async def get_regions(
    image_id: UUID,
    region_service: RegionService = Depends(get_region_service),
) -> RegionListResponse:
    return await region_service.get_regions(image_id)


@router.put("/{image_id}/regions", response_model=RegionListResponse)
async def replace_regions(
    image_id: UUID,
    data: ReplaceRegionsRequest,
    region_service: RegionService = Depends(get_region_service),
) -> RegionListResponse:
    return await region_service.replace_regions(image_id, data)


@router.patch(
    "/{image_id}/regions/{region_id}",
    response_model=RegionResponse,
)
async def update_region(
    image_id: UUID,
    region_id: UUID,
    data: RegionPatchPayload,
    region_service: RegionService = Depends(get_region_service),
) -> RegionResponse:
    return await region_service.update_region(image_id, region_id, data)


@router.post(
    "/{image_id}/detect-regions",
    response_model=DetectionResponse,
)
async def detect_regions(
    image_id: UUID,
    refresh: bool = False,
    detection_service: DetectionService = Depends(get_detection_service),
) -> DetectionResponse:
    return await detection_service.detect_regions(image_id, refresh)


# Planned endpoints (not implemented yet):
# POST   /images/{image_id}/finalize
# GET    /images/{image_id}/final-preview
# GET    /images/{image_id}/estimate
