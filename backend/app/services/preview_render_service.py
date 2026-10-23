import logging
import math
import time
from functools import lru_cache
from io import BytesIO
from uuid import UUID

import cv2
import numpy as np
from PIL import Image

from app.constants.constants import DEFAULT_PX_PER_FT, WEBP_QUALITY
from app.enums.geometry_type import GeometryType
from app.enums.region_role import RegionRole
from app.models.image_calibration import ImageCalibration
from app.models.image_region import ImageRegion
from app.services.material_service import MaterialService

logger = logging.getLogger(__name__)

_TEXTURE_TILE_FT = {
    "texture": 2.0,
    "stone": 3.0,
    "tile": 2.0,
    "wood": 4.0,
}
_SKIPPED_TEXTURES = {"metal", "glass"}


class PreviewRenderService:
    """Renders the saved regions over the source photo into a final WebP."""

    def __init__(self, material_service: MaterialService):
        self.material_service = material_service

    def render(
        self,
        source_bytes: bytes,
        width: int,
        height: int,
        regions: list[ImageRegion],
        calibration: ImageCalibration | None,
    ) -> bytes:
        logger.info(
            f"Render preview started: width: {width} | height: {height} | "
            f"region_count: {len(regions)}"
        )
        start = time.perf_counter()
        rendered = _load_source(source_bytes, width, height)
        px_per_ft = _calculate_px_per_ft(calibration, width, height)
        opening_mask = _build_opening_mask(regions, width, height)
        last_region_by_polygon = _map_last_region_per_polygon(regions)
        rendered_regions = 0

        for region in regions:
            if region.region_role != RegionRole.FINISH.value:
                continue
            if region.geometry_type != GeometryType.POLYGON.value:
                continue
            if region.material_id is None:
                continue
            if last_region_by_polygon[region.id] != region.id:
                continue

            material = self.material_service.find_material(region.material_id)
            if material is None:
                continue
            if (
                material.category == "railing"
                or material.texture in _SKIPPED_TEXTURES
            ):
                continue

            polygon = _polygon_points(region.geometry_json, width, height)
            if polygon is None:
                continue

            mask = _build_region_mask(polygon, opening_mask, width, height)
            if not np.any(mask):
                continue

            color = _resolve_region_color(
                region.color_hex, material.colors
            )
            if material.texture == "paint":
                if color is None:
                    continue
                rendered = _apply_paint(rendered, mask, color)
            else:
                if color is None:
                    color = (207, 201, 186)
                tile_ft = _TEXTURE_TILE_FT.get(material.texture, 2.0)
                rendered = _apply_texture(
                    rendered,
                    mask,
                    material.texture,
                    tile_ft,
                    px_per_ft,
                    color,
                )
            rendered_regions += 1

        content = _encode_webp(rendered)
        duration_ms = (time.perf_counter() - start) * 1000
        logger.debug(
            f"Render preview regions: rendered: {rendered_regions} | "
            f"skipped: {len(regions) - rendered_regions}"
        )
        logger.info(
            f"Render preview completed: width: {width} | "
            f"height: {height} | size_bytes: {len(content)} | "
            f"duration_ms: {duration_ms:.2f}"
        )
        return content


def _load_source(source_bytes: bytes, width: int, height: int) -> np.ndarray:
    with Image.open(BytesIO(source_bytes)) as stored:
        rgb = np.asarray(stored.convert("RGB"))
    rgb = np.ascontiguousarray(rgb)
    if rgb.shape[1] != width or rgb.shape[0] != height:
        rgb = cv2.resize(
            rgb, (width, height), interpolation=cv2.INTER_AREA
        )
    return rgb


def _calculate_px_per_ft(
    calibration: ImageCalibration | None, width: int, height: int
) -> float:
    if calibration is None:
        # Rendering-only fallback; the estimate still reports the missing scale.
        return DEFAULT_PX_PER_FT

    dx = float(calibration.p2_x - calibration.p1_x) * width
    dy = float(calibration.p2_y - calibration.p1_y) * height
    pixel_distance = math.hypot(dx, dy)
    if pixel_distance <= 0:
        return DEFAULT_PX_PER_FT

    scale_ft_per_px = float(calibration.length_ft) / pixel_distance
    if scale_ft_per_px <= 0:
        return DEFAULT_PX_PER_FT
    return 1.0 / scale_ft_per_px


def _map_last_region_per_polygon(
    regions: list[ImageRegion],
) -> dict[UUID, UUID]:
    signatures = {
        region.id: _polygon_signature(region.geometry_json)
        for region in regions
        if region.region_role == RegionRole.FINISH.value
        and region.geometry_type == GeometryType.POLYGON.value
    }
    last_by_signature: dict[tuple, UUID] = {}
    for region in regions:
        signature = signatures.get(region.id)
        if signature is not None:
            last_by_signature[signature] = region.id
    return {
        region.id: last_by_signature.get(signatures[region.id], region.id)
        if region.id in signatures
        else region.id
        for region in regions
    }


def _polygon_signature(
    geometry: list[dict[str, float]],
) -> tuple[tuple[int, int], ...] | None:
    if len(geometry) < 3:
        return None
    try:
        return tuple(
            (
                int(round(float(point["x"]) * 1_000_000)),
                int(round(float(point["y"]) * 1_000_000)),
            )
            for point in geometry
        )
    except (KeyError, TypeError, ValueError):
        return None


def _build_opening_mask(
    regions: list[ImageRegion], width: int, height: int
) -> np.ndarray:
    mask = np.zeros((height, width), np.uint8)
    for region in regions:
        if region.region_role != RegionRole.OPENING.value:
            continue
        if region.geometry_type != GeometryType.POLYGON.value:
            continue
        polygon = _polygon_points(region.geometry_json, width, height)
        if polygon is not None:
            cv2.fillPoly(mask, [polygon], 255)
    return mask


def _build_region_mask(
    polygon: np.ndarray,
    opening_mask: np.ndarray,
    width: int,
    height: int,
) -> np.ndarray:
    mask = np.zeros((height, width), np.uint8)
    cv2.fillPoly(mask, [polygon], 255)
    if np.any(opening_mask):
        mask = cv2.bitwise_and(mask, cv2.bitwise_not(opening_mask))
    return mask


def _polygon_points(
    geometry: list[dict[str, float]], width: int, height: int
) -> np.ndarray | None:
    if len(geometry) < 3:
        return None

    points = []
    for point in geometry:
        try:
            x = float(point["x"])
            y = float(point["y"])
        except (KeyError, TypeError, ValueError):
            return None
        px = int(round(x * width))
        py = int(round(y * height))
        points.append(
            [
                max(0, min(width - 1, px)),
                max(0, min(height - 1, py)),
            ]
        )
    return np.array(points, np.int32)


def _resolve_region_color(
    color_hex: str | None, material_colors: list[str]
) -> tuple[int, int, int] | None:
    color = _hex_to_rgb(color_hex)
    if color is not None:
        return color
    for candidate in material_colors:
        color = _hex_to_rgb(candidate)
        if color is not None:
            return color
    return None


def _hex_to_rgb(value: str | None) -> tuple[int, int, int] | None:
    if not value:
        return None
    value = value.strip()
    if value.startswith("#"):
        value = value[1:]
    if len(value) != 6:
        return None
    try:
        return (
            int(value[0:2], 16),
            int(value[2:4], 16),
            int(value[4:6], 16),
        )
    except ValueError:
        return None


def _apply_paint(
    image: np.ndarray,
    mask: np.ndarray,
    color: tuple[int, int, int],
) -> np.ndarray:
    return _apply_color(image, mask, color, None, 0.92)


def _apply_texture(
    image: np.ndarray,
    mask: np.ndarray,
    texture: str,
    tile_ft: float,
    px_per_ft: float,
    color: tuple[int, int, int],
) -> np.ndarray:
    height, width = image.shape[:2]
    tile_px = max(24, int(round(tile_ft * px_per_ft)))
    relief_tile = _make_relief(texture, tile_px)
    reps_y = int(math.ceil(height / tile_px))
    reps_x = int(math.ceil(width / tile_px))
    relief = np.tile(relief_tile, (reps_y, reps_x))[:height, :width]
    return _apply_color(image, mask, color, relief, 0.9)


def _apply_color(
    image: np.ndarray,
    mask: np.ndarray,
    color: tuple[int, int, int],
    relief: np.ndarray | None,
    opacity: float,
) -> np.ndarray:
    """Keep the photo's shading and set the chosen colour's hue and saturation."""
    lab = cv2.cvtColor(image, cv2.COLOR_RGB2LAB)
    lightness = lab[..., 0].astype(np.float32)
    mean = float(lightness[mask > 0].mean()) if np.any(mask > 0) else 128.0
    ratio = np.clip(lightness / max(mean, 1.0), 0.45, 1.5)
    ratio = ratio**0.9

    target_lab = cv2.cvtColor(
        np.uint8([[[color[0], color[1], color[2]]]]),
        cv2.COLOR_RGB2LAB,
    )[0, 0]
    target_lightness = float(target_lab[0])

    output = lab.copy()
    shaped = target_lightness * ratio
    if relief is not None:
        shaped = shaped * relief
    output[..., 0] = np.clip(shaped, 0, 255).astype(np.uint8)
    output[..., 1] = target_lab[1]
    output[..., 2] = target_lab[2]
    painted = cv2.cvtColor(output, cv2.COLOR_LAB2RGB)

    alpha = (
        cv2.GaussianBlur(mask, (0, 0), 2.5).astype(np.float32)
        / 255.0
        * opacity
    )
    return _blend(image, painted, alpha)


@lru_cache(maxsize=32)
def _make_relief(texture: str, size: int) -> np.ndarray:
    tile = np.full((size, size, 3), 235, np.uint8)
    if texture == "soft":
        tile = _draw_soft_pattern(tile)
    elif texture == "stone":
        tile = _draw_stone_pattern(tile)
    elif texture == "tile":
        tile = _draw_tile_pattern(tile)
    elif texture == "wood":
        tile = _draw_wood_pattern(tile)
    gray = cv2.cvtColor(tile, cv2.COLOR_RGB2GRAY).astype(np.float32)
    mean = max(float(gray.mean()), 1.0)
    return gray / mean


def _draw_soft_pattern(tile: np.ndarray) -> np.ndarray:
    size = tile.shape[0]
    for cx, cy, radius, color, opacity in (
        (0.18, 0.3, 0.05, (0, 0, 0), 0.06),
        (0.62, 0.68, 0.07, (255, 255, 255), 0.12),
        (0.82, 0.18, 0.035, (0, 0, 0), 0.05),
        (0.34, 0.84, 0.045, (255, 255, 255), 0.08),
    ):
        tile = _blend_circle(
            tile,
            int(round(cx * size)),
            int(round(cy * size)),
            max(1, int(round(radius * size))),
            color,
            opacity,
        )
    return tile


def _draw_stone_pattern(tile: np.ndarray) -> np.ndarray:
    size = tile.shape[0]
    rows = 4
    columns = 3
    row_height = size / rows

    for row in range(rows):
        y = int(round(row * row_height))
        tile = _stroke_line(
            tile,
            (0, y),
            (size - 1, y),
            (0, 0, 0),
            0.22,
            size * 0.012,
        )
        tile = _stroke_line(
            tile,
            (0, int(round(y + size * 0.014))),
            (size - 1, int(round(y + size * 0.014))),
            (255, 255, 255),
            0.16,
            size * 0.006,
        )

        offset = 0.5 if row % 2 else 0.0
        for column in range(columns):
            x = int(round((column + offset) * size / columns))
            if x >= size:
                continue
            tile = _stroke_line(
                tile,
                (x, y),
                (x, int(round(y + row_height))),
                (0, 0, 0),
                0.2,
                size * 0.01,
            )

    for cx, cy, radius, color, opacity in (
        (0.62, 0.18, 0.03, (0, 0, 0), 0.05),
        (0.28, 0.72, 0.025, (255, 255, 255), 0.1),
    ):
        tile = _blend_circle(
            tile,
            int(round(cx * size)),
            int(round(cy * size)),
            max(1, int(round(radius * size))),
            color,
            opacity,
        )
    return tile


def _draw_tile_pattern(tile: np.ndarray) -> np.ndarray:
    size = tile.shape[0]
    divisions = 4
    cell = size / divisions

    for index in range(1, divisions):
        position = int(round(index * cell))
        tile = _stroke_line(
            tile,
            (position, 0),
            (position, size - 1),
            (0, 0, 0),
            0.18,
            size * 0.012,
        )
        tile = _stroke_line(
            tile,
            (0, position),
            (size - 1, position),
            (0, 0, 0),
            0.18,
            size * 0.012,
        )
        highlight = int(round(position + size * 0.012))
        tile = _stroke_line(
            tile,
            (highlight, 0),
            (highlight, size - 1),
            (255, 255, 255),
            0.12,
            size * 0.005,
        )
        tile = _stroke_line(
            tile,
            (0, highlight),
            (size - 1, highlight),
            (255, 255, 255),
            0.12,
            size * 0.005,
        )
    return tile


def _draw_wood_pattern(tile: np.ndarray) -> np.ndarray:
    size = tile.shape[0]
    planks = 4
    plank_width = size / planks

    for index in range(planks):
        x = int(round(index * plank_width))
        tile = _stroke_line(
            tile,
            (x, 0),
            (x, size - 1),
            (0, 0, 0),
            0.28,
            size * 0.012,
        )
        tile = _stroke_line(
            tile,
            (int(round(x + size * 0.01)), 0),
            (int(round(x + size * 0.01)), size - 1),
            (255, 255, 255),
            0.1,
            size * 0.005,
        )

        grain_x = x + plank_width * 0.35
        tile = _stroke_curve(
            tile,
            grain_x,
            size,
            0.02,
            (0, 0, 0),
            0.08,
            size * 0.005,
        )
        grain_x = x + plank_width * 0.68
        tile = _stroke_curve(
            tile,
            grain_x,
            size,
            0.015,
            (255, 255, 255),
            0.08,
            size * 0.004,
        )
    return tile


def _stroke_curve(
    tile: np.ndarray,
    x: float,
    size: int,
    sway: float,
    color: tuple[int, int, int],
    opacity: float,
    thickness: float,
) -> np.ndarray:
    points = []
    for step in range(25):
        t = step / 24
        curve = (
            (1 - t) ** 3 * x
            + 3 * (1 - t) ** 2 * t * (x + sway * size)
            + 3 * (1 - t) * t**2 * (x - sway * size)
            + t**3 * x
        )
        points.append((int(round(curve)), int(round(t * size))))
    overlay = tile.copy()
    cv2.polylines(
        overlay,
        [np.array(points, np.int32)],
        False,
        color,
        max(1, int(round(thickness))),
        cv2.LINE_AA,
    )
    return _composite(tile, overlay, opacity)


def _stroke_line(
    tile: np.ndarray,
    start: tuple[int, int],
    end: tuple[int, int],
    color: tuple[int, int, int],
    opacity: float,
    thickness: float,
) -> np.ndarray:
    overlay = tile.copy()
    cv2.line(
        overlay,
        start,
        end,
        color,
        max(1, int(round(thickness))),
        cv2.LINE_AA,
    )
    return _composite(tile, overlay, opacity)


def _blend_circle(
    tile: np.ndarray,
    center_x: int,
    center_y: int,
    radius: int,
    color: tuple[int, int, int],
    opacity: float,
) -> np.ndarray:
    overlay = tile.copy()
    cv2.circle(
        overlay,
        (center_x, center_y),
        radius,
        color,
        -1,
        cv2.LINE_AA,
    )
    return _composite(tile, overlay, opacity)


def _composite(
    tile: np.ndarray, overlay: np.ndarray, opacity: float
) -> np.ndarray:
    return np.clip(
        tile.astype(np.float32) * (1 - opacity)
        + overlay.astype(np.float32) * opacity,
        0,
        255,
    ).astype(np.uint8)


def _blend(
    image: np.ndarray, layer: np.ndarray, alpha: np.ndarray
) -> np.ndarray:
    a = alpha[..., None]
    return np.clip(
        image.astype(np.float32) * (1 - a)
        + layer.astype(np.float32) * a,
        0,
        255,
    ).astype(np.uint8)


def _encode_webp(image: np.ndarray) -> bytes:
    buffer = BytesIO()
    Image.fromarray(image, "RGB").save(
        buffer, format="WEBP", quality=WEBP_QUALITY
    )
    return buffer.getvalue()
