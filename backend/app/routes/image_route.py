import logging
from uuid import UUID

from fastapi import APIRouter, Depends, Response

from app.constants.constants import (
    IMMUTABLE_IMAGE_CACHE_CONTROL,
    WEBP_MEDIA_TYPE,
)
from app.dependencies.service_dependency import (
    get_calibration_service,
    get_detection_service,
    get_estimate_service,
    get_image_service,
    get_region_service,
)
from app.dto.calibration_dto import CalibrationResponse
from app.dto.detection_dto import DetectionResponse
from app.dto.estimate_dto import ImageEstimateResponse
from app.dto.image_dto import (
    FinalizeResponse,
    ImageUpdateResponse,
    UpdateImageRequest,
)
from app.dto.region_dto import (
    RegionListResponse,
    RegionPatchPayload,
    RegionResponse,
    ReplaceRegionsRequest,
)
from app.services.calibration_service import CalibrationService
from app.services.detection_service import DetectionService
from app.services.estimate_service import EstimateService
from app.services.image_service import ImageService
from app.services.region_service import RegionService

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/{image_id}")
async def get_source_image(
    image_id: UUID,
    image_service: ImageService = Depends(get_image_service),
) -> Response:
    logger.info(f"Source image requested: image_id: {image_id}")
    image = await image_service.get_source_image(image_id)
    logger.info(
        f"Source image served: image_id: {image.id} | "
        f"size_bytes: {len(image.content)}"
    )
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
    logger.info(
        f"Update image requested: image_id: {image_id} | "
        f"fields: {sorted(data.model_fields_set)}"
    )
    response = await image_service.update_image(image_id, data)
    logger.info(
        f"Image updated: image_id: {response.id} | "
        f"sort_order: {response.sort_order} | "
        f"calibration_present: {response.calibration is not None}"
    )
    return response


@router.delete("/{image_id}", status_code=204)
async def delete_image(
    image_id: UUID,
    image_service: ImageService = Depends(get_image_service),
) -> Response:
    logger.info(f"Delete image requested: image_id: {image_id}")
    await image_service.delete_image(image_id)
    logger.info(f"Image deleted: image_id: {image_id}")
    return Response(status_code=204)


@router.get("/{image_id}/calibration", response_model=CalibrationResponse)
async def get_calibration(
    image_id: UUID,
    calibration_service: CalibrationService = Depends(get_calibration_service),
) -> CalibrationResponse:
    logger.info(f"Calibration requested: image_id: {image_id}")
    response = await calibration_service.get_calibration_response(image_id)
    logger.info(
        f"Calibration served: image_id: {response.image_id} | "
        f"has_calibration: True"
    )
    return response


@router.get("/{image_id}/regions", response_model=RegionListResponse)
async def get_regions(
    image_id: UUID,
    region_service: RegionService = Depends(get_region_service),
) -> RegionListResponse:
    logger.info(f"Regions requested: image_id: {image_id}")
    response = await region_service.get_regions(image_id)
    logger.info(
        f"Regions served: image_id: {response.image_id} | "
        f"region_count: {len(response.regions)}"
    )
    return response


@router.put("/{image_id}/regions", response_model=RegionListResponse)
async def replace_regions(
    image_id: UUID,
    data: ReplaceRegionsRequest,
    region_service: RegionService = Depends(get_region_service),
) -> RegionListResponse:
    logger.info(
        f"Replace regions requested: image_id: {image_id} | "
        f"region_count: {len(data.regions)}"
    )
    response = await region_service.replace_regions(image_id, data)
    logger.info(
        f"Regions replaced: image_id: {response.image_id} | "
        f"region_count: {len(response.regions)}"
    )
    return response


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
    logger.info(
        f"Update region requested: image_id: {image_id} | "
        f"region_id: {region_id} | "
        f"fields: {sorted(data.model_fields_set)}"
    )
    response = await region_service.update_region(
        image_id, region_id, data
    )
    logger.info(
        f"Region updated: image_id: {response.image_id} | "
        f"region_id: {response.id}"
    )
    return response


@router.post(
    "/{image_id}/detect-regions",
    response_model=DetectionResponse,
)
async def detect_regions(
    image_id: UUID,
    refresh: bool = False,
    detection_service: DetectionService = Depends(get_detection_service),
) -> DetectionResponse:
    logger.info(
        f"Detect regions requested: image_id: {image_id} | "
        f"refresh: {refresh}"
    )
    response = await detection_service.detect_regions(image_id, refresh)
    logger.info(
        f"Detect regions served: image_id: {response.image_id} | "
        f"suggestion_count: {len(response.suggestions)} | "
        f"cached: {response.cached} | truncated: {response.truncated}"
    )
    return response


@router.post(
    "/{image_id}/finalize",
    response_model=FinalizeResponse,
)
async def finalize_image(
    image_id: UUID,
    image_service: ImageService = Depends(get_image_service),
) -> FinalizeResponse:
    logger.info(f"Finalize image requested: image_id: {image_id}")
    response = await image_service.finalize_image(image_id)
    logger.info(
        f"Image finalized: image_id: {response.image_id} | "
        f"width: {response.width} | height: {response.height} | "
        f"size_bytes: {response.size_bytes}"
    )
    return response


@router.get("/{image_id}/final-preview")
async def get_final_preview(
    image_id: UUID,
    image_service: ImageService = Depends(get_image_service),
) -> Response:
    logger.info(f"Final preview requested: image_id: {image_id}")
    preview = await image_service.get_final_preview(image_id)
    logger.info(
        f"Final preview served: image_id: {preview.id} | "
        f"size_bytes: {len(preview.content)}"
    )
    return Response(
        content=preview.content,
        media_type=WEBP_MEDIA_TYPE,
        headers={"Cache-Control": "no-store"},
    )


@router.get("/{image_id}/estimate", response_model=ImageEstimateResponse)
async def get_image_estimate(
    image_id: UUID,
    estimate_service: EstimateService = Depends(get_estimate_service),
) -> ImageEstimateResponse:
    logger.info(f"Image estimate requested: image_id: {image_id}")
    response = await estimate_service.get_image_estimate(image_id)
    logger.info(
        f"Image estimate served: image_id: {image_id} | "
        f"line_count: {len(response.lines)} | "
        f"grand_total: {response.grand_total}"
    )
    return response
