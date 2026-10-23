from uuid import UUID

from starlette.concurrency import run_in_threadpool

from app.dto.calibration_dto import CalibrationPayload
from app.dto.image_dto import (
    ImageUpdateResponse,
    ImageUploadResponse,
    SourceImage,
    UpdateImageRequest,
)
from app.exceptions import ApiError
from app.models.image import Image
from app.repositories.image_repository import ImageRepository
from app.repositories.project_repository import ProjectRepository
from app.services.calibration_service import CalibrationService
from app.services.image_upload_service import ImageUploadService


class ImageService:
    """Photo upload, ordering, calibration and source streaming."""

    def __init__(
        self,
        image_repository: ImageRepository,
        project_repository: ProjectRepository,
        image_upload_service: ImageUploadService,
        calibration_service: CalibrationService,
    ):
        self.image_repository = image_repository
        self.project_repository = project_repository
        self.image_upload_service = image_upload_service
        self.calibration_service = calibration_service

    async def upload_image(
        self, project_id: UUID, data: bytes
    ) -> ImageUploadResponse:
        project = await self.project_repository.get_by_id(project_id)
        if project is None:
            raise ApiError(
                status_code=404,
                code="PROJECT_NOT_FOUND",
                message="Project not found.",
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
        return ImageUploadResponse.model_validate(image)

    async def update_image(
        self, image_id: UUID, data: UpdateImageRequest
    ) -> ImageUpdateResponse:
        """Apply a partial update; an omitted calibration stays unchanged, null clears it."""
        image = await self.image_repository.get_by_id(image_id)
        if image is None:
            raise ApiError(
                status_code=404,
                code="IMAGE_NOT_FOUND",
                message="Image not found.",
            )

        if "calibration" in data.model_fields_set:
            await self.calibration_service.set_calibration(
                image_id, data.calibration
            )
            image.final_preview_bytes = None

        if data.sort_order is not None:
            image.sort_order = data.sort_order

        await self.image_repository.save_and_commit(image)

        calibration = await self.calibration_service.find_calibration(image_id)
        return ImageUpdateResponse(
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

    async def get_source_image(self, image_id: UUID) -> SourceImage:
        image = await self.image_repository.get_with_bytes(image_id)
        if image is None:
            raise ApiError(
                status_code=404,
                code="IMAGE_NOT_FOUND",
                message="Image not found.",
            )
        return SourceImage(id=image.id, content=image.bytes)
