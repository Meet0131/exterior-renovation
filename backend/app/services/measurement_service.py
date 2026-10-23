import logging
import math
from decimal import Decimal, ROUND_HALF_UP

from app.enums.geometry_type import GeometryType
from app.exceptions import ApiError
from app.models.image_calibration import ImageCalibration
from app.models.image_region import ImageRegion

logger = logging.getLogger(__name__)

POLYGON_MEASURE_UNIT = "sqft"
LINE_MEASURE_UNIT = "rft"

_MEASURE_QUANTUM = Decimal("0.01")


class MeasurementService:
    """Resolves a region's final measure from a manual value or geometry."""

    def calculate_scale_ft_per_px(
        self, calibration: ImageCalibration, width: int, height: int
    ) -> float:
        dx = (float(calibration.p2_x) - float(calibration.p1_x)) * width
        dy = (float(calibration.p2_y) - float(calibration.p1_y)) * height
        pixel_distance = math.hypot(dx, dy)
        if pixel_distance <= 0:
            raise ApiError(
                status_code=422,
                code="UNCALIBRATED_REGION",
                message=(
                    "The saved scale is invalid. Set the known length again."
                ),
            )
        scale_ft_per_px = float(calibration.length_ft) / pixel_distance
        logger.debug(
            f"Calculated scale: width: {width} | height: {height} | "
            f"scale_ft_per_px: {scale_ft_per_px:.8f}"
        )
        return scale_ft_per_px

    def calculate_polygon_area_sqft(
        self,
        geometry_json: list[dict[str, float]],
        width: int,
        height: int,
        scale_ft_per_px: float,
    ) -> float:
        points = _read_points(geometry_json)
        if len(points) < 3:
            raise ApiError(
                status_code=422,
                code="VALIDATION_ERROR",
                message="A polygon needs at least three points to estimate.",
            )

        area = 0.0
        for index, (x1, y1) in enumerate(points):
            x2, y2 = points[(index + 1) % len(points)]
            area += x1 * y2 - x2 * y1
        normalized_area = abs(area) / 2.0
        area_sqft = (
            normalized_area
            * width
            * height
            * scale_ft_per_px
            * scale_ft_per_px
        )
        logger.debug(
            f"Calculated polygon area: points: {len(points)} | "
            f"width: {width} | height: {height} | "
            f"area_sqft: {area_sqft:.4f}"
        )
        return area_sqft

    def calculate_polyline_length_ft(
        self,
        geometry_json: list[dict[str, float]],
        width: int,
        height: int,
        scale_ft_per_px: float,
    ) -> float:
        points = _read_points(geometry_json)
        if len(points) < 2:
            raise ApiError(
                status_code=422,
                code="VALIDATION_ERROR",
                message="A line needs at least two points to estimate.",
            )

        pixel_length = 0.0
        for (x1, y1), (x2, y2) in zip(points, points[1:]):
            pixel_length += math.hypot(
                (x2 - x1) * width, (y2 - y1) * height
            )
        length_ft = pixel_length * scale_ft_per_px
        logger.debug(
            f"Calculated polyline length: points: {len(points)} | "
            f"width: {width} | height: {height} | "
            f"length_ft: {length_ft:.4f}"
        )
        return length_ft

    def calculate_final_measure(
        self,
        region: ImageRegion,
        width: int,
        height: int,
        scale_ft_per_px: float | None,
    ) -> tuple[Decimal, str]:
        logger.debug(
            f"Calculate final measure: region_id: {region.id} | "
            f"geometry_type: {region.geometry_type}"
        )
        if region.geometry_type == GeometryType.POLYGON.value:
            if region.manual_area_sqft is not None:
                measure = _quantize_measure(region.manual_area_sqft)
                logger.debug(
                    f"Final measure: region_id: {region.id} | "
                    f"source: manual | measure: {measure} | "
                    f"unit: {POLYGON_MEASURE_UNIT}"
                )
                return measure, POLYGON_MEASURE_UNIT
            if scale_ft_per_px is None:
                raise _build_uncalibrated_error(region)

            gross_area = self.calculate_polygon_area_sqft(
                region.geometry_json, width, height, scale_ft_per_px
            )
            net_area = gross_area - float(region.deduction_sqft)
            if net_area < 0:
                raise ApiError(
                    status_code=422,
                    code="NEGATIVE_NET_AREA",
                    message=(
                        f"The deduction on '{region.name}' is larger than "
                        "its gross area."
                    ),
                )
            measure = _quantize_measure(net_area)
            logger.debug(
                f"Final measure: region_id: {region.id} | "
                f"source: geometry | gross_area_sqft: {gross_area:.4f} | "
                f"net_area_sqft: {net_area:.4f} | measure: {measure} | "
                f"unit: {POLYGON_MEASURE_UNIT}"
            )
            return measure, POLYGON_MEASURE_UNIT

        if region.geometry_type == GeometryType.LINE.value:
            if region.manual_length_ft is not None:
                measure = _quantize_measure(region.manual_length_ft)
                logger.debug(
                    f"Final measure: region_id: {region.id} | "
                    f"source: manual | measure: {measure} | "
                    f"unit: {LINE_MEASURE_UNIT}"
                )
                return measure, LINE_MEASURE_UNIT
            if scale_ft_per_px is None:
                raise _build_uncalibrated_error(region)

            length_ft = self.calculate_polyline_length_ft(
                region.geometry_json, width, height, scale_ft_per_px
            )
            measure = _quantize_measure(length_ft)
            logger.debug(
                f"Final measure: region_id: {region.id} | "
                f"source: geometry | length_ft: {length_ft:.4f} | "
                f"measure: {measure} | unit: {LINE_MEASURE_UNIT}"
            )
            return measure, LINE_MEASURE_UNIT

        raise ApiError(
            status_code=422,
            code="VALIDATION_ERROR",
            message=f"The region '{region.name}' has an unknown geometry type.",
        )


def _read_points(
    geometry_json: list[dict[str, float]],
) -> list[tuple[float, float]]:
    try:
        return [
            (float(point["x"]), float(point["y"]))
            for point in geometry_json
        ]
    except (KeyError, TypeError, ValueError):
        raise ApiError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="The region geometry is invalid.",
        )


def _quantize_measure(value: Decimal | float) -> Decimal:
    return Decimal(str(value)).quantize(
        _MEASURE_QUANTUM, rounding=ROUND_HALF_UP
    )


def _build_uncalibrated_error(region: ImageRegion) -> ApiError:
    return ApiError(
        status_code=422,
        code="UNCALIBRATED_REGION",
        message=(
            "Set a known length for this photo or enter a manual measure "
            f"for '{region.name}'."
        ),
    )
