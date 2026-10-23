import logging
from dataclasses import dataclass
from io import BytesIO
from typing import NoReturn

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import settings
from app.constants.constants import (
    ALLOWED_IMAGE_FORMATS,
    MAX_IMAGE_MEAN_LUMINANCE,
    MAX_STORED_IMAGE_LONG_SIDE_PX,
    MIN_IMAGE_BLUR_SCORE,
    MIN_IMAGE_LONG_SIDE_PX,
    MIN_IMAGE_MEAN_LUMINANCE,
    WEBP_QUALITY,
)
from app.exceptions import ApiError

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PreparedImage:
    content: bytes
    width: int
    height: int


class ImageUploadService:
    """Validates an uploaded photo and converts it to a stored WebP."""

    def prepare_image(self, data: bytes) -> PreparedImage:
        if len(data) > settings.max_upload_bytes:
            _raise_image_error(
                413,
                "IMAGE_TOO_LARGE",
                f"This photo is larger than {settings.max_upload_mb} MB. "
                "Use a smaller file.",
            )
        if not data:
            _raise_image_error(
                422,
                "IMAGE_UNREADABLE",
                "The file is empty. Choose a photo.",
            )

        try:
            image = Image.open(BytesIO(data))
        except UnidentifiedImageError:
            _raise_image_error(
                415,
                "IMAGE_UNSUPPORTED_TYPE",
                "Use a JPEG, PNG or WebP photo.",
            )
        except Exception:
            _raise_image_error(
                422,
                "IMAGE_UNREADABLE",
                "This photo cannot be opened. Try a different file.",
            )

        if image.format not in ALLOWED_IMAGE_FORMATS:
            _raise_image_error(
                415,
                "IMAGE_UNSUPPORTED_TYPE",
                "Use a JPEG, PNG or WebP photo.",
            )

        try:
            image.load()
        except Exception:
            _raise_image_error(
                422,
                "IMAGE_UNREADABLE",
                "This photo cannot be read. Try a different file.",
            )

        image = ImageOps.exif_transpose(image)
        width, height = image.size
        if max(width, height) < MIN_IMAGE_LONG_SIDE_PX:
            _raise_image_error(
                422,
                "IMAGE_TOO_SMALL",
                f"Use a photo at least {MIN_IMAGE_LONG_SIDE_PX} pixels "
                "on its long side.",
            )

        gray = np.asarray(image.convert("L"))
        blur_score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        if blur_score < MIN_IMAGE_BLUR_SCORE:
            _raise_image_error(
                422,
                "IMAGE_TOO_BLURRY",
                "This photo is too blurry to measure. "
                "Use a sharper, well-lit photo.",
            )

        mean_luminance = float(gray.mean())
        if mean_luminance < MIN_IMAGE_MEAN_LUMINANCE:
            _raise_image_error(
                422,
                "IMAGE_TOO_DARK",
                "This photo is too dark. Use a photo with more even daylight.",
            )
        if mean_luminance > MAX_IMAGE_MEAN_LUMINANCE:
            _raise_image_error(
                422,
                "IMAGE_TOO_BRIGHT",
                "This photo is too bright. Avoid direct glare or overexposure.",
            )

        image = _convert_to_rgb(image)
        image.thumbnail(
            (MAX_STORED_IMAGE_LONG_SIDE_PX, MAX_STORED_IMAGE_LONG_SIDE_PX),
            Image.Resampling.LANCZOS,
        )
        width, height = image.size

        buffer = BytesIO()
        image.save(buffer, format="WEBP", quality=WEBP_QUALITY)
        content = buffer.getvalue()
        logger.info(
            "Prepared image upload: %sx%s, %s bytes",
            width,
            height,
            len(content),
        )
        return PreparedImage(content=content, width=width, height=height)


def _convert_to_rgb(image: Image.Image) -> Image.Image:
    if image.mode in {"RGBA", "LA"} or (
        image.mode == "P" and "transparency" in image.info
    ):
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel("A"))
        return background
    return image.convert("RGB")


def _raise_image_error(status_code: int, code: str, message: str) -> NoReturn:
    logger.info("Rejected image upload: code=%s", code)
    raise ApiError(
        status_code=status_code,
        code=code,
        message=message,
        field="file",
    )
