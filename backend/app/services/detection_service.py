import asyncio
import logging
import math
from io import BytesIO
from typing import NoReturn
from uuid import UUID

from PIL import Image
from pydantic import BaseModel, ValidationError
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.constants.constants import (
    DETECTION_IMAGE_MAX_SIDE_PX,
    DETECTION_JPEG_QUALITY,
    DETECTION_MAX_SUGGESTIONS,
    DETECTION_TIMEOUT_SECONDS,
)
from app.dto.detection_dto import (
    DetectedRegionSuggestion,
    DetectionResponse,
    DetectionSnapshot,
)
from app.dto.region_dto import GeometryPoint
from app.enums.geometry_type import GeometryType
from app.enums.region_role import RegionRole
from app.enums.surface_type import SurfaceType
from app.exceptions import ApiError
from app.repositories.image_repository import ImageRepository
from app.utils.geometry_utils import has_self_intersection
from app.utils.time_utils import utc_now

logger = logging.getLogger(__name__)

_DETECTION_UNAVAILABLE_MESSAGE = (
    "Region suggestions are unavailable right now. "
    "Draw the regions manually."
)

_DETECTION_PROMPT = """You are labelling the exterior of a residential building for a renovation planner.
Return every visible instance of these classes: main wall, window, balcony,
pillar or column, parapet wall, gate area, roof edge.

For each instance return:
- label: one of the class names above
- box_2d: [ymin, xmin, ymax, xmax] normalized to 0-1000
- mask: polygon points [[x, y], ...] normalized to 0-1000, following the visible edge
- confidence: a number from 0 to 1

Rules:
- Trace only what is visible; do not invent hidden surfaces.
- Treat each continuous wall plane as one region.
- A window is an opening, not a wall.
- If a class is absent, return no item for it.
Return JSON matching the provided schema."""

_LABEL_MAP: dict[str, tuple[SurfaceType, RegionRole, str]] = {
    "main wall": (SurfaceType.WALL, RegionRole.FINISH, "Main wall"),
    "wall": (SurfaceType.WALL, RegionRole.FINISH, "Main wall"),
    "window": (SurfaceType.WINDOW, RegionRole.OPENING, "Window"),
    "door": (SurfaceType.DOOR, RegionRole.OPENING, "Door"),
    "balcony": (SurfaceType.BALCONY_SLAB, RegionRole.FINISH, "Balcony"),
    "balcony slab": (SurfaceType.BALCONY_SLAB, RegionRole.FINISH, "Balcony"),
    "pillar": (SurfaceType.PILLAR, RegionRole.FINISH, "Pillar"),
    "pillar or column": (SurfaceType.PILLAR, RegionRole.FINISH, "Pillar"),
    "column": (SurfaceType.PILLAR, RegionRole.FINISH, "Pillar"),
    "parapet": (SurfaceType.PARAPET, RegionRole.FINISH, "Parapet"),
    "parapet wall": (SurfaceType.PARAPET, RegionRole.FINISH, "Parapet"),
    "gate": (SurfaceType.GATE, RegionRole.REFERENCE, "Gate"),
    "gate area": (SurfaceType.GATE, RegionRole.REFERENCE, "Gate"),
    "roof edge": (SurfaceType.ROOF_EDGE, RegionRole.REFERENCE, "Roof edge"),
    "railing": (SurfaceType.RAILING, RegionRole.FINISH, "Railing"),
    "trim": (SurfaceType.TRIM, RegionRole.FINISH, "Trim"),
}


class GeminiMaskRegion(BaseModel):
    label: str
    box_2d: list[float] | None = None
    mask: list[list[float]]
    confidence: float


class GeminiDetectionResult(BaseModel):
    regions: list[GeminiMaskRegion]


class DetectionService:
    """Suggests facade regions with Gemini and caches the result on the photo."""

    def __init__(self, image_repository: ImageRepository):
        self.image_repository = image_repository

    async def detect_regions(
        self, image_id: UUID, refresh: bool
    ) -> DetectionResponse:
        image = await self.image_repository.get_with_bytes(image_id)
        if image is None:
            raise ApiError(
                status_code=404,
                code="IMAGE_NOT_FOUND",
                message="Image not found.",
            )

        if image.ai_detection_json is not None and not refresh:
            try:
                snapshot = DetectionSnapshot.model_validate(
                    image.ai_detection_json
                )
            except ValidationError:
                logger.warning(
                    "Ignoring invalid detection cache for image %s", image_id
                )
            else:
                return _build_cached_response(image_id, snapshot)

        if not settings.gemini_api_key.strip():
            _raise_detection_unavailable()

        try:
            jpeg_bytes = await run_in_threadpool(
                self._prepare_jpeg, image.bytes
            )
            result = await asyncio.wait_for(
                self._detect_with_gemini(jpeg_bytes),
                timeout=DETECTION_TIMEOUT_SECONDS,
            )
            suggestions, truncated = _to_suggestions(result)
        except Exception as exc:
            logger.warning("Detection failed for image %s: %s", image_id, exc)
            _raise_detection_unavailable()

        detected_at = utc_now()
        snapshot = DetectionSnapshot(
            detected_at=detected_at,
            suggestions=suggestions,
        )
        image.ai_detection_json = snapshot.model_dump(mode="json")
        await self.image_repository.save_and_commit(image)

        return DetectionResponse(
            image_id=image_id,
            suggestions=suggestions,
            detected_at=detected_at,
            cached=False,
            truncated=truncated,
        )

    async def _detect_with_gemini(
        self, jpeg_bytes: bytes
    ) -> GeminiDetectionResult:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=settings.gemini_api_key)
        response = await client.aio.models.generate_content(
            model=settings.gemini_model,
            contents=[
                types.Part.from_bytes(
                    data=jpeg_bytes, mime_type="image/jpeg"
                ),
                types.Part.from_text(text=_DETECTION_PROMPT),
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=GeminiDetectionResult,
                temperature=0,
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            ),
        )

        parsed = response.parsed
        if isinstance(parsed, GeminiDetectionResult):
            return parsed
        if parsed is not None:
            return GeminiDetectionResult.model_validate(parsed)

        text = response.text
        if not text:
            raise ValueError("Gemini returned no structured content.")
        return GeminiDetectionResult.model_validate_json(text)

    def _prepare_jpeg(self, webp_bytes: bytes) -> bytes:
        with Image.open(BytesIO(webp_bytes)) as stored:
            image = stored.convert("RGB")
            image.thumbnail(
                (DETECTION_IMAGE_MAX_SIDE_PX, DETECTION_IMAGE_MAX_SIDE_PX),
                Image.Resampling.LANCZOS,
            )
            buffer = BytesIO()
            image.save(
                buffer,
                format="JPEG",
                quality=DETECTION_JPEG_QUALITY,
            )
            return buffer.getvalue()


def _build_cached_response(
    image_id: UUID, snapshot: DetectionSnapshot
) -> DetectionResponse:
    suggestions = snapshot.suggestions[:DETECTION_MAX_SUGGESTIONS]
    return DetectionResponse(
        image_id=image_id,
        suggestions=suggestions,
        detected_at=snapshot.detected_at,
        cached=True,
        truncated=len(snapshot.suggestions) > DETECTION_MAX_SUGGESTIONS,
    )


def _to_suggestions(
    result: GeminiDetectionResult,
) -> tuple[list[DetectedRegionSuggestion], bool]:
    suggestions: list[DetectedRegionSuggestion] = []
    for region in result.regions:
        mapping = _LABEL_MAP.get(_normalize_label(region.label))
        if mapping is None:
            continue

        points = _normalize_mask(region.mask)
        if points is None:
            continue

        surface_type, region_role, display_name = mapping
        suggestions.append(
            DetectedRegionSuggestion(
                name=display_name,
                geometry_type=GeometryType.POLYGON,
                geometry_json=points,
                surface_type=surface_type,
                region_role=region_role,
                confidence=_clamp_confidence(region.confidence),
            )
        )

    truncated = len(suggestions) > DETECTION_MAX_SUGGESTIONS
    return suggestions[:DETECTION_MAX_SUGGESTIONS], truncated


def _normalize_label(label: str) -> str:
    return " ".join(label.strip().lower().replace("_", " ").split())


def _clamp_confidence(value: float) -> float:
    if not math.isfinite(value):
        return 0.0
    return max(0.0, min(1.0, value))


def _normalize_mask(
    mask: list[list[float]],
) -> list[GeometryPoint] | None:
    points: list[GeometryPoint] = []
    for pair in mask:
        if len(pair) < 2:
            return None

        x = float(pair[0])
        y = float(pair[1])
        if not (math.isfinite(x) and math.isfinite(y)):
            return None

        point = GeometryPoint(
            x=max(0.0, min(1.0, x / 1000.0)),
            y=max(0.0, min(1.0, y / 1000.0)),
        )
        if points and point == points[-1]:
            continue
        points.append(point)

    if len(points) >= 2 and points[0] == points[-1]:
        points.pop()

    if len(points) < 3:
        return None

    if has_self_intersection(
        [(point.x, point.y) for point in points]
    ):
        return None

    return points


def _raise_detection_unavailable() -> NoReturn:
    raise ApiError(
        status_code=503,
        code="DETECTION_UNAVAILABLE",
        message=_DETECTION_UNAVAILABLE_MESSAGE,
    )
