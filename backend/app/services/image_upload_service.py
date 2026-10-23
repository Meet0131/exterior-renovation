import logging
from dataclasses import dataclass
from io import BytesIO
from typing import NoReturn

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import Config
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
        logger.info(f"Prepare image started: size_bytes: {len(data)}")
        if len(data) > Config.MAX_UPLOAD_BYTES:
            _raise_image_error(
                413,
                "IMAGE_TOO_LARGE",
                f"This photo is larger than {Config.MAX_UPLOAD_MB} MB. "
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

        logger.debug(
            f"Opened image: format: {image.format} | mode: {image.mode} | "
            f"width: {image.size[0]} | height: {image.size[1]}"
        )

        try:
            # JPEG can decode at a reduced scale; PNG and WebP cannot.
            if image.format in {"JPEG", "MPO"}:
                image.draft(
                    "RGB",
                    (
                        MAX_STORED_IMAGE_LONG_SIDE_PX,
                        MAX_STORED_IMAGE_LONG_SIDE_PX,
                    ),
                )
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

        # Resize before the quality checks: full-resolution gradients on a
        # large phone photo can exceed the deployment memory limit.
        image.thumbnail(
            (MAX_STORED_IMAGE_LONG_SIDE_PX, MAX_STORED_IMAGE_LONG_SIDE_PX),
            Image.Resampling.LANCZOS,
        )
        image = _convert_to_rgb(image)
        width, height = image.size
        logger.debug(
            f"Resized image: width: {width} | height: {height}"
        )

        gray = np.asarray(image.convert("L"))
        blur_score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        mean_luminance = float(gray.mean())
        logger.debug(
            f"Image quality: blur_score: {blur_score:.2f} | "
            f"mean_luminance: {mean_luminance:.2f}"
        )
        if blur_score < MIN_IMAGE_BLUR_SCORE:
            _raise_image_error(
                422,
                "IMAGE_TOO_BLURRY",
                "This photo is too blurry to measure. "
                "Use a sharper, well-lit photo.",
            )

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

        buffer = BytesIO()
        image.save(buffer, format="WEBP", quality=WEBP_QUALITY)
        content = buffer.getvalue()
        logger.info(
            f"Prepare image completed: width: {width} | height: {height} | "
            f"input_bytes: {len(data)} | stored_bytes: {len(content)}"
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
    logger.warning(f"Image upload rejected: code: {code}")
    raise ApiError(
        status_code=status_code,
        code=code,
        message=message,
        field="file",
    )
