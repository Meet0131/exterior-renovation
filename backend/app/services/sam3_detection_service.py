import base64
import logging
import math
import time
from dataclasses import dataclass
from typing import Any

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.config import Config
from app.constants.constants import (
    DETECTION_SAM3_CONNECT_TIMEOUT_SECONDS,
    DETECTION_SAM3_MAX_CANDIDATES,
    DETECTION_SAM3_OUTPUT_PROB_THRESHOLD,
    DETECTION_SAM3_TIMEOUT_SECONDS,
)

logger = logging.getLogger(__name__)

SAM3_OUTPUT_PROMPTS: tuple[str, ...] = (
    "house wall",
    "building wall",
    "exterior wall",
    "house window",
    "building window",
    "house door",
    "balcony",
    "pillar",
    "parapet",
    "gate",
    "roof edge",
    "railing",
)
SAM3_PRIOR_PROMPTS: tuple[str, ...] = ("building facade",)
SAM3_EXCLUSION_PROMPTS: tuple[str, ...] = ("car", "tree", "hedge")
SAM3_PROMPTS: tuple[str, ...] = (
    SAM3_OUTPUT_PROMPTS + SAM3_PRIOR_PROMPTS + SAM3_EXCLUSION_PROMPTS
)

_SAM3_PROMPT_FAMILIES: dict[str, str] = {
    "house wall": "wall",
    "building wall": "wall",
    "exterior wall": "wall",
    "house window": "window",
    "building window": "window",
    "house door": "door",
    "balcony": "balcony",
    "pillar": "pillar",
    "parapet": "parapet",
    "gate": "gate",
    "roof edge": "roof_edge",
    "railing": "railing",
    "building facade": "building",
    "car": "exclusion",
    "tree": "exclusion",
    "hedge": "exclusion",
}


class Sam3DetectionError(Exception):
    def __init__(self, reason: str, status_code: int | None = None):
        self.reason = reason
        self.status_code = status_code
        super().__init__(reason)


@dataclass(frozen=True)
class Sam3Candidate:
    label: str
    family: str
    confidence: float
    polygons: list[list[tuple[float, float]]]


class _Sam3Prediction(BaseModel):
    masks: object | None = None
    mask: object | None = None
    confidence: float | None = None

    model_config = ConfigDict(extra="ignore")


class _Sam3PromptResult(BaseModel):
    prompt_index: int | None = None
    echo: object | None = None
    predictions: list[object] = Field(default_factory=list)

    model_config = ConfigDict(extra="ignore")


class Sam3DetectionService:
    """Calls Roboflow's hosted SAM 3 concept segmentation endpoint."""

    async def detect(self, jpeg_bytes: bytes) -> list[Sam3Candidate]:
        api_key = (Config.ROBOFLOW_API_KEY or "").strip()
        if not api_key:
            raise Sam3DetectionError("missing_key")

        payload = {
            "image": {
                "type": "base64",
                "value": base64.b64encode(jpeg_bytes).decode("ascii"),
            },
            "prompts": [
                {"type": "text", "text": prompt}
                for prompt in SAM3_PROMPTS
            ],
            "format": "polygon",
            "output_prob_thresh": DETECTION_SAM3_OUTPUT_PROB_THRESHOLD,
        }
        headers = {"Authorization": f"Bearer {api_key}"}
        timeout = httpx.Timeout(
            DETECTION_SAM3_TIMEOUT_SECONDS,
            connect=min(
                DETECTION_SAM3_CONNECT_TIMEOUT_SECONDS,
                DETECTION_SAM3_TIMEOUT_SECONDS,
            ),
        )

        logger.info(
            f"SAM3 request started: prompt_count: {len(SAM3_PROMPTS)} | "
            f"jpeg_bytes: {len(jpeg_bytes)}"
        )
        start = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    Config.ROBOFLOW_SAM3_URL,
                    json=payload,
                    headers=headers,
                )
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            duration_ms = (time.perf_counter() - start) * 1000
            logger.warning(
                f"SAM3 request failed: reason: http_timeout | "
                f"error_type: {type(exc).__name__} | "
                f"duration_ms: {duration_ms:.2f}"
            )
            raise Sam3DetectionError("http_timeout") from exc
        except httpx.HTTPStatusError as exc:
            duration_ms = (time.perf_counter() - start) * 1000
            logger.warning(
                f"SAM3 request failed: reason: http_error | "
                f"status: {exc.response.status_code} | "
                f"response_bytes: {len(exc.response.content)} | "
                f"duration_ms: {duration_ms:.2f}"
            )
            raise Sam3DetectionError(
                "http_error", status_code=exc.response.status_code
            ) from exc
        except httpx.RequestError as exc:
            duration_ms = (time.perf_counter() - start) * 1000
            logger.warning(
                f"SAM3 request failed: reason: request_error | "
                f"error_type: {type(exc).__name__} | "
                f"duration_ms: {duration_ms:.2f}"
            )
            raise Sam3DetectionError("request_error") from exc

        duration_ms = (time.perf_counter() - start) * 1000
        try:
            body = response.json()
        except ValueError as exc:
            logger.warning(
                f"SAM3 response invalid: reason: parse_error | "
                f"duration_ms: {duration_ms:.2f}"
            )
            raise Sam3DetectionError("parse_error") from exc

        candidates = _parse_candidates(body)
        provider_time = body.get("time") if isinstance(body, dict) else None
        logger.info(
            f"SAM3 response parsed: candidate_count: {len(candidates)} | "
            f"provider_time_s: {provider_time!r} | "
            f"duration_ms: {duration_ms:.2f}"
        )
        return candidates


def _parse_candidates(payload: Any) -> list[Sam3Candidate]:
    if not isinstance(payload, dict):
        raise Sam3DetectionError("parse_error")

    prompt_results = payload.get("prompt_results")
    if not isinstance(prompt_results, list):
        raise Sam3DetectionError("parse_error")

    candidates: list[Sam3Candidate] = []
    skipped_prompts = 0
    skipped_predictions = 0
    raw_prediction_count = 0

    for raw_prompt_result in prompt_results:
        try:
            prompt_result = _Sam3PromptResult.model_validate(
                raw_prompt_result
            )
        except ValidationError:
            skipped_prompts += 1
            continue

        label = _resolve_label(prompt_result)
        if label is None:
            skipped_prompts += 1
            continue

        family = _resolve_family(label)
        if family is None:
            skipped_prompts += 1
            continue

        for raw_prediction in prompt_result.predictions:
            raw_prediction_count += 1
            try:
                prediction = _Sam3Prediction.model_validate(raw_prediction)
            except ValidationError:
                skipped_predictions += 1
                continue

            confidence = prediction.confidence
            if confidence is None or not math.isfinite(confidence):
                skipped_predictions += 1
                continue

            raw_masks = (
                prediction.masks
                if prediction.masks
                else prediction.mask
            )
            polygons = _extract_polygons(raw_masks)
            if not polygons:
                skipped_predictions += 1
                continue

            if len(candidates) < DETECTION_SAM3_MAX_CANDIDATES:
                candidates.append(
                    Sam3Candidate(
                        label=label,
                        family=family,
                        confidence=float(confidence),
                        polygons=polygons,
                    )
                )

    if skipped_prompts or skipped_predictions:
        logger.warning(
            f"SAM3 response skipped items: "
            f"prompt_results: {skipped_prompts} | "
            f"predictions: {skipped_predictions}"
        )
    if (
        prompt_results
        and not candidates
        and (
            skipped_prompts == len(prompt_results)
            or (
                raw_prediction_count > 0
                and skipped_predictions == raw_prediction_count
            )
        )
    ):
        raise Sam3DetectionError("parse_error")

    overflow = raw_prediction_count - skipped_predictions
    overflow -= len(candidates)
    if overflow > 0:
        logger.warning(
            f"SAM3 response candidate cap reached: "
            f"ignored_predictions: {overflow} | "
            f"cap: {DETECTION_SAM3_MAX_CANDIDATES}"
        )
    return candidates


def _resolve_label(
    prompt_result: _Sam3PromptResult,
) -> str | None:
    prompt_index = prompt_result.prompt_index
    if (
        isinstance(prompt_index, int)
        and not isinstance(prompt_index, bool)
        and 0 <= prompt_index < len(SAM3_PROMPTS)
    ):
        return SAM3_PROMPTS[prompt_index]

    echo = prompt_result.echo
    if isinstance(echo, dict):
        text = echo.get("text")
        if isinstance(text, str) and text.strip():
            return text
    return None


def _resolve_family(label: str) -> str | None:
    normalized = " ".join(
        label.strip().lower().replace("_", " ").split()
    )
    return _SAM3_PROMPT_FAMILIES.get(normalized)


def _extract_polygons(raw_masks: Any) -> list[list[tuple[float, float]]]:
    if raw_masks is None or isinstance(raw_masks, dict):
        return []

    single = _to_polygon(raw_masks)
    if single is not None:
        return [single]

    if not isinstance(raw_masks, (list, tuple)):
        return []

    polygons: list[list[tuple[float, float]]] = []
    for raw_polygon in raw_masks:
        polygon = _to_polygon(raw_polygon)
        if polygon is not None:
            polygons.append(polygon)
    return polygons


def _to_polygon(raw_polygon: Any) -> list[tuple[float, float]] | None:
    if not isinstance(raw_polygon, (list, tuple)):
        return None

    if _is_flat_coordinate_list(raw_polygon):
        raw_points = [
            raw_polygon[index : index + 2]
            for index in range(0, len(raw_polygon), 2)
        ]
    else:
        raw_points = list(raw_polygon)

    if len(raw_points) < 3:
        return None

    points: list[tuple[float, float]] = []
    for raw_point in raw_points:
        point = _to_point(raw_point)
        if point is None:
            return None
        points.append(point)
    return points


def _is_flat_coordinate_list(values: list[Any] | tuple[Any, ...]) -> bool:
    if len(values) < 6 or len(values) % 2 != 0:
        return False
    return all(_is_number(value) for value in values)


def _to_point(raw_point: Any) -> tuple[float, float] | None:
    if not isinstance(raw_point, (list, tuple)) or len(raw_point) < 2:
        return None
    x = raw_point[0]
    y = raw_point[1]
    if not (_is_number(x) and _is_number(y)):
        return None
    return float(x), float(y)


def _is_number(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if not isinstance(value, (int, float)):
        return False
    return math.isfinite(float(value))
