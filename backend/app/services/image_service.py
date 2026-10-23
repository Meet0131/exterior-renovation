import asyncio
import logging
import time
from uuid import UUID

from starlette.concurrency import run_in_threadpool

from app.constants.constants import (
    FINALIZE_TIMEOUT_SECONDS,
    MAX_PHOTOS_PER_PROJECT,
)
from app.dto.calibration_dto import CalibrationPayload
from app.dto.image_dto import (
    FinalPreview,
    FinalizeResponse,
    ImageUpdateResponse,
    ImageUploadResponse,
    SourceImage,
    UpdateImageRequest,
)
from app.exceptions import ApiError
from app.models.image import Image
from app.repositories.image_region_repository import ImageRegionRepository
from app.repositories.image_repository import ImageRepository
from app.repositories.project_repository import ProjectRepository
from app.services.calibration_service import CalibrationService
from app.services.image_upload_service import ImageUploadService
from app.services.preview_render_service import PreviewRenderService

logger = logging.getLogger(__name__)


class ImageService:
    """Photo upload, ordering, calibration, final render and streaming."""

    def __init__(
        self,
        image_repository: ImageRepository,
        project_repository: ProjectRepository,
        region_repository: ImageRegionRepository,
        image_upload_service: ImageUploadService,
        calibration_service: CalibrationService,
        preview_render_service: PreviewRenderService,
    ):
        self.image_repository = image_repository
        self.project_repository = project_repository
        self.region_repository = region_repository
        self.image_upload_service = image_upload_service
        self.calibration_service = calibration_service
        self.preview_render_service = preview_render_service

    async def upload_image(
        self, project_id: UUID, data: bytes
    ) -> ImageUploadResponse:
        logger.info(
            f"Upload image started: project_id: {project_id} | "
            f"size_bytes: {len(data)}"
        )
        project = await self.project_repository.get_by_id(project_id)
        if project is None:
            raise ApiError(
                status_code=404,
                code="PROJECT_NOT_FOUND",
                message="Project not found.",
            )

        photo_count = await self.image_repository.count_images_for_project(
            project_id
        )
        logger.debug(
            f"Project photo count: project_id: {project_id} | "
            f"count: {photo_count} | max: {MAX_PHOTOS_PER_PROJECT}"
        )
        if photo_count >= MAX_PHOTOS_PER_PROJECT:
            raise ApiError(
                status_code=422,
                code="PROJECT_PHOTO_LIMIT_REACHED",
                message=(
                    "This project already has the maximum of "
                    f"{MAX_PHOTOS_PER_PROJECT} photos."
                ),
            )

        logger.debug(
            f"Preparing image upload: project_id: {project_id} | "
            f"size_bytes: {len(data)}"
        )
        prepared = await run_in_threadpool(
            self.image_upload_service.prepare_image, data
        )
        sort_order = await self.image_repository.get_next_sort_order(project_id)
        image = Image(
            project_id=project_id,
            sort_order=sort_order,
            width=prepared.width,
            height=prepared.height,
            bytes=prepared.content,
        )
        await self.image_repository.save_and_commit(image)
        response = ImageUploadResponse.model_validate(image)
        logger.info(
            f"Upload image completed: project_id: {project_id} | "
            f"image_id: {response.id} | width: {response.width} | "
            f"height: {response.height} | "
            f"stored_bytes: {len(prepared.content)}"
        )
        return response

    async def update_image(
        self, image_id: UUID, data: UpdateImageRequest
    ) -> ImageUpdateResponse:
        """Apply a partial update; an omitted calibration stays unchanged, null clears it."""
        logger.info(
            f"Update image started: image_id: {image_id} | "
            f"fields: {sorted(data.model_fields_set)}"
        )
        image = await self.image_repository.get_by_id(image_id)
        if image is None:
            raise ApiError(
                status_code=404,
                code="IMAGE_NOT_FOUND",
                message="Image not found.",
            )

        if "calibration" in data.model_fields_set:
            logger.debug(f"Updating image calibration: image_id: {image_id}")
            await self.calibration_service.set_calibration(
                image_id, data.calibration
            )
            image.final_preview_bytes = None
            logger.debug(
                f"Cleared final preview after calibration change: "
                f"image_id: {image_id}"
            )

        if data.sort_order is not None:
            image.sort_order = data.sort_order

        await self.image_repository.save_and_commit(image)

        calibration = await self.calibration_service.find_calibration(image_id)
        response = ImageUpdateResponse(
            id=image.id,
            project_id=image.project_id,
            sort_order=image.sort_order,
            width=image.width,
            height=image.height,
            created_at=image.created_at,
            calibration=(
                CalibrationPayload.model_validate(calibration)
                if calibration is not None
                else None
            ),
        )
        logger.info(
            f"Update image completed: image_id: {response.id} | "
            f"sort_order: {response.sort_order} | "
            f"calibration_present: {response.calibration is not None}"
        )
        return response

    async def delete_image(self, image_id: UUID) -> None:
        logger.info(f"Delete image started: image_id: {image_id}")
        image = await self.image_repository.get_by_id(image_id)
        if image is None:
            raise ApiError(
                status_code=404,
                code="IMAGE_NOT_FOUND",
                message="Image not found.",
            )

        photo_count = await self.image_repository.count_images_for_project(
            image.project_id
        )
        if photo_count <= 1:
            raise ApiError(
                status_code=422,
                code="LAST_PHOTO_REQUIRED",
                message="A project needs at least one photo.",
            )

        await self.image_repository.delete(image)
        await self.image_repository.commit()
        logger.info(
            f"Delete image completed: image_id: {image_id} | "
            f"project_id: {image.project_id}"
        )

    async def finalize_image(self, image_id: UUID) -> FinalizeResponse:
        logger.info(f"Finalize image started: image_id: {image_id}")
        image = await self.image_repository.get_with_bytes(image_id)
        if image is None:
            raise ApiError(
                status_code=404,
                code="IMAGE_NOT_FOUND",
                message="Image not found.",
            )

        regions = await self.region_repository.get_for_image(image_id)
        calibration = await self.calibration_service.find_calibration(image_id)
        logger.info(
            f"Rendering final preview: image_id: {image_id} | "
            f"width: {image.width} | height: {image.height} | "
            f"region_count: {len(regions)}"
        )

        start = time.perf_counter()
        try:
            rendered = await asyncio.wait_for(
                run_in_threadpool(
                    self.preview_render_service.render,
                    image.bytes,
                    image.width,
                    image.height,
                    regions,
                    calibration,
                ),
                timeout=FINALIZE_TIMEOUT_SECONDS,
            )
        except TimeoutError:
            duration_ms = (time.perf_counter() - start) * 1000
            logger.warning(
                f"Final render timed out: image_id: {image_id} | "
                f"timeout_seconds: {FINALIZE_TIMEOUT_SECONDS} | "
                f"duration_ms: {duration_ms:.2f}"
            )
            raise ApiError(
                status_code=503,
                code="FINALIZE_UNAVAILABLE",
                message="Final render failed. Try again.",
            )
        except Exception:
            logger.exception(f"Final render failed: image_id: {image_id}")
            raise ApiError(
                status_code=503,
                code="FINALIZE_UNAVAILABLE",
                message="Final render failed. Try again.",
            )

        image.final_preview_bytes = rendered
        await self.image_repository.save_and_commit(image)
        duration_ms = (time.perf_counter() - start) * 1000
        response = FinalizeResponse(
            image_id=image.id,
            stored=True,
            width=image.width,
            height=image.height,
            size_bytes=len(rendered),
        )
        logger.info(
            f"Finalize image completed: image_id: {response.image_id} | "
            f"width: {response.width} | height: {response.height} | "
            f"size_bytes: {response.size_bytes} | "
            f"duration_ms: {duration_ms:.2f}"
        )
        return response

    async def get_final_preview(self, image_id: UUID) -> FinalPreview:
        logger.debug(f"Get final preview started: image_id: {image_id}")
        image = await self.image_repository.get_with_final_preview(image_id)
        if image is None:
            raise ApiError(
                status_code=404,
                code="IMAGE_NOT_FOUND",
                message="Image not found.",
                headers={"Cache-Control": "no-store"},
            )
        if image.final_preview_bytes is None:
            raise ApiError(
                status_code=404,
                code="FINAL_PREVIEW_NOT_FOUND",
                message="No current final preview. Continue to estimate first.",
                headers={"Cache-Control": "no-store"},
            )
        logger.debug(
            f"Get final preview completed: image_id: {image.id} | "
            f"size_bytes: {len(image.final_preview_bytes)}"
        )
        return FinalPreview(id=image.id, content=image.final_preview_bytes)

    async def get_source_image(self, image_id: UUID) -> SourceImage:
        logger.debug(f"Get source image started: image_id: {image_id}")
        image = await self.image_repository.get_with_bytes(image_id)
        if image is None:
            raise ApiError(
                status_code=404,
                code="IMAGE_NOT_FOUND",
                message="Image not found.",
            )
        logger.debug(
            f"Get source image completed: image_id: {image.id} | "
            f"size_bytes: {len(image.bytes)}"
        )
        return SourceImage(id=image.id, content=image.bytes)
