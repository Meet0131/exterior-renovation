import asyncio
import logging
import math
import time
from dataclasses import dataclass
from io import BytesIO
from typing import NoReturn
from uuid import UUID

import cv2
import numpy as np
from PIL import Image
from pydantic import BaseModel, ValidationError
from starlette.concurrency import run_in_threadpool

from app.config import Config
from app.constants.constants import (
    DETECTION_GEMINI_TIMEOUT_SECONDS,
    DETECTION_IMAGE_MAX_SIDE_PX,
    DETECTION_JPEG_QUALITY,
    DETECTION_MAX_SUGGESTIONS,
    DETECTION_MIN_PROVIDER_SECONDS,
    DETECTION_SAM3_CROSS_FAMILY_IOU,
    DETECTION_SAM3_DEDUPE_CONFIDENCE_TIE,
    DETECTION_SAM3_DEDUPE_CONTAINMENT,
    DETECTION_SAM3_DEDUPE_DISTINCT_OVERLAP,
    DETECTION_SAM3_DEDUPE_IOU,
    DETECTION_SAM3_EXCLUSION_COVERAGE,
    DETECTION_SAM3_EXCLUSION_MAX_MASK_COVERAGE,
    DETECTION_SAM3_MIN_MASK_PIXELS,
    DETECTION_SAM3_PRIOR_BBOX_MARGIN,
    DETECTION_SAM3_SIMPLIFY_EPSILON_RATIO,
    DETECTION_SAM3_SIMPLIFY_MIN_EPSILON_PX,
    DETECTION_SAM3_TIMEOUT_SECONDS,
    DETECTION_SNAPSHOT_CACHE_VERSION,
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
from app.services.sam3_detection_service import (
    Sam3Candidate,
    Sam3DetectionError,
    Sam3DetectionService,
)
from app.utils.geometry_utils import has_self_intersection
from app.utils.time_utils import utc_now

logger = logging.getLogger(__name__)

_DETECTION_UNAVAILABLE_MESSAGE = (
    "Region suggestions are unavailable right now. "
    "Draw the regions manually."
)
_POINT_EPSILON = 1e-9

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

_SAM3_FAMILY_MAP: dict[
    str, tuple[SurfaceType, RegionRole, str]
] = {
    "wall": (SurfaceType.WALL, RegionRole.FINISH, "Main wall"),
    "window": (SurfaceType.WINDOW, RegionRole.OPENING, "Window"),
    "door": (SurfaceType.DOOR, RegionRole.OPENING, "Door"),
    "balcony": (SurfaceType.BALCONY_SLAB, RegionRole.FINISH, "Balcony"),
    "pillar": (SurfaceType.PILLAR, RegionRole.FINISH, "Pillar"),
    "parapet": (SurfaceType.PARAPET, RegionRole.FINISH, "Parapet"),
    "gate": (SurfaceType.GATE, RegionRole.REFERENCE, "Gate"),
    "roof_edge": (SurfaceType.ROOF_EDGE, RegionRole.REFERENCE, "Roof edge"),
    "railing": (SurfaceType.RAILING, RegionRole.FINISH, "Railing"),
}
_FAMILY_PRIORITY: dict[str, int] = {
    "wall": 0,
    "window": 1,
    "door": 2,
    "gate": 3,
    "balcony": 4,
    "pillar": 5,
    "parapet": 6,
    "roof_edge": 7,
    "railing": 8,
}
_BUILDING_CONTAINMENT_FAMILIES = frozenset(
    {
        "wall",
        "window",
        "door",
        "balcony",
        "pillar",
        "parapet",
        "roof_edge",
    }
)
_MASK_SIZE = 256


@dataclass(frozen=True)
class PreparedDetectionImage:
    content: bytes
    width: int
    height: int


@dataclass(frozen=True)
class _NormalizedSam3Candidate:
    family: str
    confidence: float
    points: list[GeometryPoint]
    mask: np.ndarray
    mask_area: int
    area_fraction: float
    bbox: tuple[float, float, float, float]


@dataclass(frozen=True)
class Sam3FilterStats:
    raw: int = 0
    normalized: int = 0
    invalid: int = 0
    exclusion_drops: int = 0
    building_drops: int = 0
    duplicate_drops: int = 0
    cross_family_drops: int = 0
    final: int = 0
    prior_available: bool = False
    exclusion_available: bool = False
    fallback: bool = False
    duration_ms: float = 0.0


class GeminiMaskRegion(BaseModel):
    label: str
    box_2d: list[float] | None = None
    mask: list[list[float]]
    confidence: float


class GeminiDetectionResult(BaseModel):
    regions: list[GeminiMaskRegion]


class DetectionService:
    """Suggests facade regions with SAM 3 and falls back to Gemini."""

    def __init__(
        self,
        image_repository: ImageRepository,
        sam3_detection_service: Sam3DetectionService,
    ):
        self.image_repository = image_repository
        self.sam3_detection_service = sam3_detection_service

    async def detect_regions(
        self, image_id: UUID, refresh: bool
    ) -> DetectionResponse:
        logger.info(
            f"Detect regions started: image_id: {image_id} | "
            f"refresh: {refresh}"
        )
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
                    f"Ignoring invalid detection cache: image_id: {image_id}"
                )
            else:
                if (
                    snapshot.cache_version
                    == DETECTION_SNAPSHOT_CACHE_VERSION
                ):
                    response = _build_cached_response(image_id, snapshot)
                    logger.debug(
                        f"Detection cache hit: image_id: {image_id} | "
                        f"suggestion_count: {len(response.suggestions)} | "
                        f"truncated: {response.truncated}"
                    )
                    return response
                logger.info(
                    f"Detection cache stale: image_id: {image_id} | "
                    f"cache_version: {snapshot.cache_version} | "
                    f"current_version: {DETECTION_SNAPSHOT_CACHE_VERSION}"
                )

        sam3_configured = bool(
            (Config.ROBOFLOW_API_KEY or "").strip()
        )
        gemini_configured = bool((Config.GEMINI_API_KEY or "").strip())
        if not sam3_configured and not gemini_configured:
            logger.warning(
                f"Detection unavailable: image_id: {image_id} | "
                f"reason: missing_api_keys"
            )
            _raise_detection_unavailable()

        start = time.perf_counter()
        deadline = start + DETECTION_TIMEOUT_SECONDS

        try:
            logger.debug(
                f"Preparing detection image: image_id: {image_id}"
            )
            prepared = await run_in_threadpool(
                self._prepare_jpeg, image.bytes
            )
            logger.debug(
                f"Prepared detection image: image_id: {image_id} | "
                f"width: {prepared.width} | height: {prepared.height} | "
                f"jpeg_bytes: {len(prepared.content)}"
            )
        except Exception:
            logger.exception(
                f"Detection image preparation failed: image_id: {image_id}"
            )
            _raise_detection_unavailable()

        provider: str | None = None
        suggestions: list[DetectedRegionSuggestion] = []
        truncated = False
        raw_count = 0
        fallback_reason: str | None = None
        sam3_filter_stats: Sam3FilterStats | None = None

        if sam3_configured:
            sam3_budget = min(
                DETECTION_SAM3_TIMEOUT_SECONDS,
                _remaining_seconds(deadline),
            )
            if sam3_budget < DETECTION_MIN_PROVIDER_SECONDS:
                fallback_reason = "insufficient_time"
            else:
                sam3_start = time.perf_counter()
                try:
                    candidates = await asyncio.wait_for(
                        self.sam3_detection_service.detect(
                            prepared.content
                        ),
                        timeout=sam3_budget,
                    )
                    try:
                        (
                            suggestions,
                            truncated,
                            sam3_filter_stats,
                        ) = await run_in_threadpool(
                            _to_sam3_suggestions,
                            candidates,
                            prepared.width,
                            prepared.height,
                        )
                    except Exception:
                        logger.warning(
                            f"SAM3 suggestion filter failed: "
                            f"image_id: {image_id}",
                            exc_info=True,
                        )
                        suggestions, truncated = await run_in_threadpool(
                            _to_sam3_suggestions_basic,
                            candidates,
                            prepared.width,
                            prepared.height,
                        )
                        sam3_filter_stats = Sam3FilterStats(
                            raw=len(candidates),
                            final=len(suggestions),
                            fallback=True,
                        )
                except TimeoutError:
                    fallback_reason = "timeout"
                    _log_provider_failure(
                        "SAM3", image_id, fallback_reason, sam3_start
                    )
                except Sam3DetectionError as exc:
                    fallback_reason = exc.reason
                    _log_provider_failure(
                        "SAM3",
                        image_id,
                        fallback_reason,
                        sam3_start,
                        status_code=exc.status_code,
                    )
                except Exception as exc:
                    fallback_reason = "unexpected_error"
                    _log_provider_failure(
                        "SAM3",
                        image_id,
                        fallback_reason,
                        sam3_start,
                        error_type=type(exc).__name__,
                        exc_info=True,
                    )
                else:
                    provider = "sam3"
                    raw_count = len(candidates)
                    logger.info(
                        f"SAM3 detection completed: image_id: {image_id} | "
                        f"candidate_count: {raw_count} | "
                        f"suggestion_count: {len(suggestions)} | "
                        f"truncated: {truncated} | "
                        f"duration_ms: "
                        f"{(time.perf_counter() - sam3_start) * 1000:.2f}"
                    )
                    if sam3_filter_stats is not None:
                        _log_sam3_filter_stats(
                            image_id, sam3_filter_stats
                        )
        else:
            fallback_reason = "missing_sam3_key"

        if provider is None:
            if not gemini_configured:
                logger.warning(
                    f"Detection unavailable: image_id: {image_id} | "
                    f"reason: missing_gemini_key | "
                    f"sam3_reason: {fallback_reason}"
                )
                _raise_detection_unavailable()

            gemini_budget = min(
                DETECTION_GEMINI_TIMEOUT_SECONDS,
                _remaining_seconds(deadline),
            )
            if gemini_budget < DETECTION_MIN_PROVIDER_SECONDS:
                logger.warning(
                    f"Detection unavailable: image_id: {image_id} | "
                    f"reason: insufficient_time | "
                    f"sam3_reason: {fallback_reason}"
                )
                _raise_detection_unavailable()

            logger.warning(
                f"Gemini fallback started: image_id: {image_id} | "
                f"reason: {fallback_reason}"
            )
            gemini_start = time.perf_counter()
            try:
                result = await asyncio.wait_for(
                    self._detect_with_gemini(prepared.content),
                    timeout=gemini_budget,
                )
                suggestions, truncated = _to_gemini_suggestions(result)
            except TimeoutError:
                _log_provider_failure(
                    "Gemini", image_id, "timeout", gemini_start
                )
                _raise_detection_unavailable()
            except Exception as exc:
                _log_provider_failure(
                    "Gemini",
                    image_id,
                    "unexpected_error",
                    gemini_start,
                    error_type=type(exc).__name__,
                    exc_info=True,
                )
                _raise_detection_unavailable()

            provider = "gemini"
            raw_count = len(result.regions)
            logger.info(
                f"Gemini detection completed: image_id: {image_id} | "
                f"model: {Config.GEMINI_MODEL} | "
                f"raw_region_count: {raw_count} | "
                f"suggestion_count: {len(suggestions)} | "
                f"truncated: {truncated} | "
                f"duration_ms: "
                f"{(time.perf_counter() - gemini_start) * 1000:.2f}"
            )

        duration_ms = (time.perf_counter() - start) * 1000
        logger.info(
            f"Detection completed: image_id: {image_id} | "
            f"provider: {provider} | raw_region_count: {raw_count} | "
            f"suggestion_count: {len(suggestions)} | "
            f"truncated: {truncated} | duration_ms: {duration_ms:.2f}"
        )

        detected_at = utc_now()
        snapshot = DetectionSnapshot(
            detected_at=detected_at,
            suggestions=suggestions,
            cache_version=DETECTION_SNAPSHOT_CACHE_VERSION,
        )
        image.ai_detection_json = snapshot.model_dump(mode="json")
        await self.image_repository.save_and_commit(image)

        response = DetectionResponse(
            image_id=image_id,
            suggestions=suggestions,
            detected_at=detected_at,
            cached=False,
            truncated=truncated,
        )
        logger.info(
            f"Detect regions completed: image_id: {image_id} | "
            f"provider: {provider} | "
            f"suggestion_count: {len(response.suggestions)} | "
            f"cached: False | truncated: {response.truncated}"
        )
        return response

    async def _detect_with_gemini(
        self, jpeg_bytes: bytes
    ) -> GeminiDetectionResult:
        from google import genai
        from google.genai import types

        logger.debug(
            f"Gemini request started: model: {Config.GEMINI_MODEL} | "
            f"jpeg_bytes: {len(jpeg_bytes)}"
        )
        client = genai.Client(api_key=Config.GEMINI_API_KEY)
        response = await client.aio.models.generate_content(
            model=Config.GEMINI_MODEL,
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
        logger.debug(
            f"Gemini response received: model: {Config.GEMINI_MODEL} | "
            f"parsed: {parsed is not None}"
        )
        if isinstance(parsed, GeminiDetectionResult):
            return parsed
        if parsed is not None:
            return GeminiDetectionResult.model_validate(parsed)

        text = response.text
        if not text:
            raise ValueError("Gemini returned no structured content.")
        return GeminiDetectionResult.model_validate_json(text)

    def _prepare_jpeg(self, webp_bytes: bytes) -> PreparedDetectionImage:
        logger.debug(
            f"Preparing detection JPEG: source_bytes: {len(webp_bytes)}"
        )
        with Image.open(BytesIO(webp_bytes)) as stored:
            image = stored.convert("RGB")
            image.thumbnail(
                (DETECTION_IMAGE_MAX_SIDE_PX, DETECTION_IMAGE_MAX_SIDE_PX),
                Image.Resampling.LANCZOS,
            )
            width, height = image.size
            buffer = BytesIO()
            image.save(
                buffer,
                format="JPEG",
                quality=DETECTION_JPEG_QUALITY,
            )
            content = buffer.getvalue()
            logger.debug(
                f"Prepared detection JPEG: width: {width} | "
                f"height: {height} | jpeg_bytes: {len(content)}"
            )
            return PreparedDetectionImage(
                content=content,
                width=width,
                height=height,
            )


def _remaining_seconds(deadline: float) -> float:
    return max(0.0, deadline - time.perf_counter())


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


def _to_gemini_suggestions(
    result: GeminiDetectionResult,
) -> tuple[list[DetectedRegionSuggestion], bool]:
    suggestions: list[DetectedRegionSuggestion] = []
    for region in result.regions:
        mapping = _LABEL_MAP.get(_normalize_label(region.label))
        if mapping is None:
            continue

        points = _normalize_gemini_mask(region.mask)
        if points is None:
            continue

        suggestion = _build_suggestion(
            region.label, points, region.confidence
        )
        if suggestion is not None:
            suggestions.append(suggestion)

    truncated = len(suggestions) > DETECTION_MAX_SUGGESTIONS
    return suggestions[:DETECTION_MAX_SUGGESTIONS], truncated


def _to_sam3_suggestions(
    candidates: list[Sam3Candidate],
    width: int,
    height: int,
) -> tuple[list[DetectedRegionSuggestion], bool, Sam3FilterStats]:
    start = time.perf_counter()
    normalized: list[_NormalizedSam3Candidate] = []
    invalid = 0
    for candidate in candidates:
        item = _normalize_sam3_candidate(candidate, width, height)
        if item is None:
            invalid += 1
            continue
        normalized.append(item)

    output = [
        item
        for item in normalized
        if item.family in _SAM3_FAMILY_MAP
    ]
    prior_mask = _build_building_prior(normalized)
    prior_bbox = (
        _mask_bbox(prior_mask) if prior_mask is not None else None
    )
    exclusion_mask = _build_exclusion_mask(normalized)

    filtered: list[_NormalizedSam3Candidate] = []
    exclusion_drops = 0
    building_drops = 0
    for item in output:
        if (
            exclusion_mask is not None
            and _mask_coverage(item.mask, exclusion_mask)
            >= DETECTION_SAM3_EXCLUSION_COVERAGE
        ):
            exclusion_drops += 1
            continue
        if (
            prior_bbox is not None
            and item.family in _BUILDING_CONTAINMENT_FAMILIES
            and not _bbox_center_inside(item.bbox, prior_bbox)
        ):
            building_drops += 1
            continue
        filtered.append(item)

    by_family: dict[str, list[_NormalizedSam3Candidate]] = {}
    for item in filtered:
        by_family.setdefault(item.family, []).append(item)

    kept: list[_NormalizedSam3Candidate] = []
    duplicate_drops = 0
    for family_items in by_family.values():
        family_kept, family_drops = _dedupe_same_family(
            family_items
        )
        kept.extend(family_kept)
        duplicate_drops += family_drops

    kept, cross_family_drops = _dedupe_cross_family(kept)
    duplicate_drops += cross_family_drops
    kept.sort(key=_output_sort_key)

    truncated = len(kept) > DETECTION_MAX_SUGGESTIONS
    kept = kept[:DETECTION_MAX_SUGGESTIONS]
    suggestions = [
        _build_family_suggestion(
            item.family, item.points, item.confidence
        )
        for item in kept
    ]
    stats = Sam3FilterStats(
        raw=len(candidates),
        normalized=len(normalized),
        invalid=invalid,
        exclusion_drops=exclusion_drops,
        building_drops=building_drops,
        duplicate_drops=duplicate_drops,
        cross_family_drops=cross_family_drops,
        final=len(suggestions),
        prior_available=prior_mask is not None,
        exclusion_available=exclusion_mask is not None,
        fallback=False,
        duration_ms=(time.perf_counter() - start) * 1000,
    )
    return suggestions, truncated, stats


def _to_sam3_suggestions_basic(
    candidates: list[Sam3Candidate],
    width: int,
    height: int,
) -> tuple[list[DetectedRegionSuggestion], bool]:
    suggestions: list[DetectedRegionSuggestion] = []
    for candidate in candidates:
        if candidate.family not in _SAM3_FAMILY_MAP:
            continue
        points = _normalize_sam3_polygon(
            candidate.polygons, width, height
        )
        if points is None:
            continue
        suggestions.append(
            _build_family_suggestion(
                candidate.family,
                points,
                _clamp_confidence(candidate.confidence),
            )
        )

    suggestions.sort(key=lambda item: item.confidence, reverse=True)
    truncated = len(suggestions) > DETECTION_MAX_SUGGESTIONS
    return suggestions[:DETECTION_MAX_SUGGESTIONS], truncated


def _normalize_sam3_candidate(
    candidate: Sam3Candidate,
    width: int,
    height: int,
) -> _NormalizedSam3Candidate | None:
    components = _normalize_sam3_components(
        candidate.polygons, width, height
    )
    if not components:
        return None

    points = components[0]
    mask = _rasterize_components(components)
    ys, xs = np.nonzero(mask)
    mask_area = int(xs.size)
    if mask_area < DETECTION_SAM3_MIN_MASK_PIXELS:
        return None
    if (
        int(xs.max()) - int(xs.min()) < 1
        or int(ys.max()) - int(ys.min()) < 1
    ):
        return None

    area_fraction = _polygon_area(
        [(point.x, point.y) for point in points]
    )
    if area_fraction <= 0:
        return None

    xs_normalized = [point.x for point in points]
    ys_normalized = [point.y for point in points]
    return _NormalizedSam3Candidate(
        family=candidate.family,
        confidence=_clamp_confidence(candidate.confidence),
        points=points,
        mask=mask,
        mask_area=mask_area,
        area_fraction=area_fraction,
        bbox=(
            min(xs_normalized),
            min(ys_normalized),
            max(xs_normalized),
            max(ys_normalized),
        ),
    )


def _normalize_sam3_components(
    polygons: list[list[tuple[float, float]]],
    width: int,
    height: int,
) -> list[list[GeometryPoint]]:
    if width <= 0 or height <= 0:
        return []

    components: list[tuple[float, list[GeometryPoint]]] = []
    for polygon in polygons:
        pixels = _to_pixel_polygon(polygon, width, height)
        if pixels is None:
            continue
        area = _polygon_area(pixels)
        if area <= 0:
            continue
        points = _simplify_sam3_polygon(pixels, width, height)
        if points is None:
            continue
        components.append((area, points))

    components.sort(key=lambda item: item[0], reverse=True)
    return [points for _, points in components]


def _rasterize_components(
    components: list[list[GeometryPoint]],
) -> np.ndarray:
    mask = np.zeros((_MASK_SIZE, _MASK_SIZE), np.uint8)
    for points in components:
        pixel_points = _to_mask_points(points)
        if len(pixel_points) >= 3:
            cv2.fillPoly(mask, [pixel_points], 1)
    return mask


def _to_mask_points(points: list[GeometryPoint]) -> np.ndarray:
    pixel_points = []
    for point in points:
        x = int(round(point.x * (_MASK_SIZE - 1)))
        y = int(round(point.y * (_MASK_SIZE - 1)))
        pixel_points.append(
            [
                max(0, min(_MASK_SIZE - 1, x)),
                max(0, min(_MASK_SIZE - 1, y)),
            ]
        )
    return np.array(pixel_points, np.int32)


def _mask_coverage(
    candidate_mask: np.ndarray,
    container_mask: np.ndarray,
) -> float:
    area = int(np.count_nonzero(candidate_mask))
    if area == 0:
        return 0.0
    intersection = int(
        np.count_nonzero(
            np.logical_and(candidate_mask, container_mask)
        )
    )
    return intersection / area


def _mask_pair_overlap(
    first: np.ndarray,
    second: np.ndarray,
) -> tuple[float, float]:
    first_area = int(np.count_nonzero(first))
    second_area = int(np.count_nonzero(second))
    if first_area == 0 or second_area == 0:
        return 0.0, 0.0

    intersection = int(
        np.count_nonzero(np.logical_and(first, second))
    )
    union = first_area + second_area - intersection
    iou = intersection / union if union > 0 else 0.0
    containment = intersection / min(first_area, second_area)
    return iou, containment


def _mask_bbox(
    mask: np.ndarray,
) -> tuple[float, float, float, float] | None:
    ys, xs = np.nonzero(mask)
    if xs.size == 0:
        return None
    scale = _MASK_SIZE - 1
    return (
        int(xs.min()) / scale,
        int(ys.min()) / scale,
        int(xs.max()) / scale,
        int(ys.max()) / scale,
    )


def _bbox_center_inside(
    candidate_bbox: tuple[float, float, float, float],
    prior_bbox: tuple[float, float, float, float],
) -> bool:
    center_x = (candidate_bbox[0] + candidate_bbox[2]) / 2
    center_y = (candidate_bbox[1] + candidate_bbox[3]) / 2
    margin = DETECTION_SAM3_PRIOR_BBOX_MARGIN
    return (
        prior_bbox[0] - margin <= center_x <= prior_bbox[2] + margin
        and prior_bbox[1] - margin <= center_y <= prior_bbox[3] + margin
    )


def _build_building_prior(
    normalized: list[_NormalizedSam3Candidate],
) -> np.ndarray | None:
    return _union_candidate_masks(
        [
            item
            for item in normalized
            if item.family in {"building", "wall"}
        ]
    )


def _build_exclusion_mask(
    normalized: list[_NormalizedSam3Candidate],
) -> np.ndarray | None:
    items = [
        item for item in normalized if item.family == "exclusion"
    ]
    mask = _union_candidate_masks(items)
    if mask is None:
        return None

    coverage = int(np.count_nonzero(mask)) / (
        _MASK_SIZE * _MASK_SIZE
    )
    if coverage > DETECTION_SAM3_EXCLUSION_MAX_MASK_COVERAGE:
        logger.warning(
            f"SAM3 exclusion mask ignored: coverage: {coverage:.3f}"
        )
        return None
    return mask


def _union_candidate_masks(
    items: list[_NormalizedSam3Candidate],
) -> np.ndarray | None:
    if not items:
        return None

    mask = np.zeros((_MASK_SIZE, _MASK_SIZE), np.uint8)
    for item in items:
        mask = np.maximum(mask, item.mask)
    if not np.any(mask):
        return None
    return mask


def _representative_key(
    item: _NormalizedSam3Candidate,
) -> tuple[int, float, float]:
    confidence_bucket = math.floor(
        item.confidence / DETECTION_SAM3_DEDUPE_CONFIDENCE_TIE
    )
    return (
        -confidence_bucket,
        -item.area_fraction,
        -item.confidence,
    )


def _output_sort_key(
    item: _NormalizedSam3Candidate,
) -> tuple[float, int, float]:
    return (
        -item.confidence,
        _FAMILY_PRIORITY.get(item.family, 99),
        -item.area_fraction,
    )


def _dedupe_same_family(
    items: list[_NormalizedSam3Candidate],
) -> tuple[list[_NormalizedSam3Candidate], int]:
    if len(items) <= 1:
        return items, 0

    group_parents: set[int] = set()
    for parent_index, parent in enumerate(items):
        children: list[int] = []
        for child_index, child in enumerate(items):
            if parent_index == child_index:
                continue
            if parent.mask_area <= child.mask_area:
                continue
            intersection = int(
                np.count_nonzero(
                    np.logical_and(parent.mask, child.mask)
                )
            )
            if (
                intersection / child.mask_area
                >= DETECTION_SAM3_DEDUPE_CONTAINMENT
            ):
                children.append(child_index)

        distinct_children: list[int] = []
        for child_index in sorted(
            children,
            key=lambda index: _representative_key(items[index]),
        ):
            if all(
                _mask_pair_overlap(
                    items[child_index].mask,
                    items[kept_index].mask,
                )[1]
                < DETECTION_SAM3_DEDUPE_DISTINCT_OVERLAP
                for kept_index in distinct_children
            ):
                distinct_children.append(child_index)

        if len(distinct_children) >= 2:
            group_parents.add(parent_index)

    survivors = [
        item
        for index, item in enumerate(items)
        if index not in group_parents
    ]
    survivors.sort(key=_representative_key)

    kept: list[_NormalizedSam3Candidate] = []
    for item in survivors:
        duplicate = False
        for existing in kept:
            iou, containment = _mask_pair_overlap(
                item.mask, existing.mask
            )
            if (
                iou >= DETECTION_SAM3_DEDUPE_IOU
                or containment >= DETECTION_SAM3_DEDUPE_CONTAINMENT
            ):
                duplicate = True
                break
        if not duplicate:
            kept.append(item)
    return kept, len(items) - len(kept)


def _dedupe_cross_family(
    items: list[_NormalizedSam3Candidate],
) -> tuple[list[_NormalizedSam3Candidate], int]:
    ordered = sorted(items, key=_representative_key)
    kept: list[_NormalizedSam3Candidate] = []
    drops = 0
    for item in ordered:
        duplicate = False
        for existing in kept:
            if existing.family == item.family:
                continue
            iou, _ = _mask_pair_overlap(item.mask, existing.mask)
            if iou >= DETECTION_SAM3_CROSS_FAMILY_IOU:
                duplicate = True
                break
        if duplicate:
            drops += 1
            continue
        kept.append(item)
    return kept, drops


def _build_family_suggestion(
    family: str,
    points: list[GeometryPoint],
    confidence: float,
) -> DetectedRegionSuggestion:
    surface_type, region_role, display_name = _SAM3_FAMILY_MAP[
        family
    ]
    return DetectedRegionSuggestion(
        name=display_name,
        geometry_type=GeometryType.POLYGON,
        geometry_json=points,
        surface_type=surface_type,
        region_role=region_role,
        confidence=_clamp_confidence(confidence),
    )


def _build_suggestion(
    label: str,
    points: list[GeometryPoint],
    confidence: float,
) -> DetectedRegionSuggestion | None:
    mapping = _LABEL_MAP.get(_normalize_label(label))
    if mapping is None:
        return None

    surface_type, region_role, display_name = mapping
    return DetectedRegionSuggestion(
        name=display_name,
        geometry_type=GeometryType.POLYGON,
        geometry_json=points,
        surface_type=surface_type,
        region_role=region_role,
        confidence=_clamp_confidence(confidence),
    )


def _normalize_label(label: str) -> str:
    return " ".join(label.strip().lower().replace("_", " ").split())


def _clamp_confidence(value: float) -> float:
    if not math.isfinite(value):
        return 0.0
    return max(0.0, min(1.0, value))


def _normalize_gemini_mask(
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


def _normalize_sam3_polygon(
    polygons: list[list[tuple[float, float]]],
    width: int,
    height: int,
) -> list[GeometryPoint] | None:
    components = _normalize_sam3_components(
        polygons, width, height
    )
    return components[0] if components else None


def _simplify_sam3_polygon(
    pixels: list[tuple[float, float]],
    width: int,
    height: int,
) -> list[GeometryPoint] | None:
    contour = np.asarray(pixels, dtype=np.float32).reshape(-1, 1, 2)
    epsilon = max(
        DETECTION_SAM3_SIMPLIFY_MIN_EPSILON_PX,
        DETECTION_SAM3_SIMPLIFY_EPSILON_RATIO
        * cv2.arcLength(contour, True),
    )
    approx = cv2.approxPolyDP(contour, epsilon, True)
    simplified = [
        (float(point[0][0]), float(point[0][1])) for point in approx
    ]
    cleaned = _clean_polygon(simplified, width, height)
    if len(cleaned) < 3:
        return None

    normalized = [
        (
            max(0.0, min(1.0, x / width)),
            max(0.0, min(1.0, y / height)),
        )
        for x, y in cleaned
    ]
    if _polygon_area(normalized) <= 0:
        return None

    if has_self_intersection(normalized):
        return None

    return [GeometryPoint(x=x, y=y) for x, y in normalized]


def _to_pixel_polygon(
    polygon: list[tuple[float, float]],
    width: int,
    height: int,
) -> list[tuple[float, float]] | None:
    if len(polygon) < 3:
        return None

    points = [(float(x), float(y)) for x, y in polygon]
    if not all(
        math.isfinite(x) and math.isfinite(y) for x, y in points
    ):
        return None

    if all(0.0 <= x <= 1.0 and 0.0 <= y <= 1.0 for x, y in points):
        points = [(x * width, y * height) for x, y in points]

    cleaned = _clean_polygon(points, width, height)
    if len(cleaned) < 3:
        return None
    return cleaned


def _clean_polygon(
    points: list[tuple[float, float]],
    width: int,
    height: int,
) -> list[tuple[float, float]]:
    cleaned: list[tuple[float, float]] = []
    for x, y in points:
        point = (
            max(0.0, min(float(width), x)),
            max(0.0, min(float(height), y)),
        )
        if cleaned and _points_equal(cleaned[-1], point):
            continue
        cleaned.append(point)

    if len(cleaned) >= 2 and _points_equal(cleaned[0], cleaned[-1]):
        cleaned.pop()
    return cleaned


def _points_equal(
    first: tuple[float, float], second: tuple[float, float]
) -> bool:
    return (
        abs(first[0] - second[0]) <= _POINT_EPSILON
        and abs(first[1] - second[1]) <= _POINT_EPSILON
    )


def _polygon_area(points: list[tuple[float, float]]) -> float:
    area = 0.0
    count = len(points)
    for index in range(count):
        x1, y1 = points[index]
        x2, y2 = points[(index + 1) % count]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2.0


def _log_sam3_filter_stats(
    image_id: UUID,
    stats: Sam3FilterStats,
) -> None:
    logger.info(
        f"SAM3 post-filter completed: image_id: {image_id} | "
        f"raw_candidates: {stats.raw} | "
        f"normalized: {stats.normalized} | "
        f"invalid: {stats.invalid} | "
        f"exclusion_drops: {stats.exclusion_drops} | "
        f"building_drops: {stats.building_drops} | "
        f"duplicate_drops: {stats.duplicate_drops} | "
        f"cross_family_drops: {stats.cross_family_drops} | "
        f"final: {stats.final} | "
        f"prior: {stats.prior_available} | "
        f"exclusion: {stats.exclusion_available} | "
        f"fallback: {stats.fallback} | "
        f"duration_ms: {stats.duration_ms:.2f}"
    )


def _log_provider_failure(
    provider: str,
    image_id: UUID,
    reason: str,
    started_at: float,
    status_code: int | None = None,
    error_type: str | None = None,
    exc_info: bool = False,
) -> None:
    duration_ms = (time.perf_counter() - started_at) * 1000
    logger.warning(
        f"{provider} detection failed: image_id: {image_id} | "
        f"reason: {reason} | status: {status_code} | "
        f"error_type: {error_type} | duration_ms: {duration_ms:.2f}",
        exc_info=exc_info,
    )


def _raise_detection_unavailable() -> NoReturn:
    raise ApiError(
        status_code=503,
        code="DETECTION_UNAVAILABLE",
        message=_DETECTION_UNAVAILABLE_MESSAGE,
    )
