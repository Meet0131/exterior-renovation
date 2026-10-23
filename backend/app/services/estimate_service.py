import logging
from dataclasses import dataclass
from decimal import Decimal, ROUND_CEILING, ROUND_HALF_UP
from uuid import UUID

from app.constants.constants import CONTINGENCY_PCT, CONTINGENCY_RATE
from app.dto.estimate_dto import (
    EstimateLineResponse,
    ImageEstimateResponse,
    ProjectEstimateResponse,
    ProjectImageEstimateResponse,
)
from app.dto.material_dto import MaterialResponse
from app.enums.region_role import RegionRole
from app.exceptions import ApiError
from app.models.image import Image
from app.models.image_calibration import ImageCalibration
from app.models.image_region import ImageRegion
from app.repositories.image_calibration_repository import ImageCalibrationRepository
from app.repositories.image_region_repository import ImageRegionRepository
from app.repositories.image_repository import ImageRepository
from app.repositories.project_repository import ProjectRepository
from app.services.material_service import MaterialService
from app.services.measurement_service import MeasurementService
from app.services.quantity_service import QuantityService

logger = logging.getLogger(__name__)

_RUPEE = Decimal("1")
_CENT = Decimal("0.01")
_ZERO = Decimal("0")


@dataclass(frozen=True)
class CalculatedLine:
    region_id: UUID
    region_name: str
    material_name: str
    material_category: str
    final_measure: Decimal
    measure_unit: str
    waste_pct: Decimal
    purchase_qty: Decimal
    purchase_unit: str
    material_rate: Decimal
    labor_rate: Decimal
    material_cost: Decimal
    labor_cost: Decimal
    line_total: Decimal


@dataclass(frozen=True)
class CalculatedImageEstimate:
    image_id: UUID
    lines: list[CalculatedLine]
    subtotal_material: Decimal
    subtotal_labor: Decimal


@dataclass(frozen=True)
class CalculatedProjectEstimate:
    images: list[CalculatedImageEstimate]
    subtotal_material: Decimal
    subtotal_labor: Decimal
    contingency: Decimal
    grand_total: Decimal


class EstimateService:
    """Builds photo estimates and aggregates them into a project total."""

    def __init__(
        self,
        project_repository: ProjectRepository,
        image_repository: ImageRepository,
        calibration_repository: ImageCalibrationRepository,
        region_repository: ImageRegionRepository,
        material_service: MaterialService,
        measurement_service: MeasurementService,
        quantity_service: QuantityService,
    ):
        self.project_repository = project_repository
        self.image_repository = image_repository
        self.calibration_repository = calibration_repository
        self.region_repository = region_repository
        self.material_service = material_service
        self.measurement_service = measurement_service
        self.quantity_service = quantity_service

    async def get_image_estimate(
        self, image_id: UUID
    ) -> ImageEstimateResponse:
        logger.info(f"Get image estimate started: image_id: {image_id}")
        image = await self.image_repository.get_by_id(image_id)
        if image is None:
            raise ApiError(
                status_code=404,
                code="IMAGE_NOT_FOUND",
                message="Image not found.",
            )

        calibration = await self.calibration_repository.get_by_id(image_id)
        regions = await self.region_repository.get_for_image(image_id)
        lines = self._calculate_lines(
            image.width, image.height, calibration, regions
        )
        response = _build_image_response(lines)
        logger.info(
            f"Get image estimate completed: image_id: {image_id} | "
            f"line_count: {len(response.lines)} | "
            f"grand_total: {response.grand_total}"
        )
        return response

    async def get_project_estimate(
        self, project_id: UUID
    ) -> ProjectEstimateResponse:
        logger.info(
            f"Get project estimate started: project_id: {project_id}"
        )
        project = await self.project_repository.get_by_id(project_id)
        if project is None:
            raise ApiError(
                status_code=404,
                code="PROJECT_NOT_FOUND",
                message="Project not found.",
            )

        images = await self.image_repository.get_for_project_with_estimate_data(
            project_id
        )
        calculated = self.calculate_project_estimate(images)
        response = _build_project_response(calculated)
        logger.info(
            f"Get project estimate completed: project_id: {project_id} | "
            f"image_count: {len(response.images)} | "
            f"grand_total: {response.grand_total}"
        )
        return response

    def calculate_project_estimate(
        self, images: list[Image]
    ) -> CalculatedProjectEstimate:
        """Uses the same line engine for estimate responses and the PDF."""
        logger.info(
            f"Calculate project estimate started: "
            f"image_count: {len(images)}"
        )
        image_estimates: list[CalculatedImageEstimate] = []
        subtotal_material = _ZERO
        subtotal_labor = _ZERO

        for image in images:
            lines = self._calculate_lines(
                image.width,
                image.height,
                image.calibration,
                image.regions,
            )
            material, labor = _sum_line_costs(lines)
            subtotal_material += material
            subtotal_labor += labor
            image_estimates.append(
                CalculatedImageEstimate(
                    image_id=image.id,
                    lines=lines,
                    subtotal_material=material,
                    subtotal_labor=labor,
                )
            )
            logger.debug(
                f"Image estimate calculated: image_id: {image.id} | "
                f"line_count: {len(lines)} | "
                f"subtotal_material: {material} | subtotal_labor: {labor}"
            )

        contingency, grand_total = _calculate_contingency(
            subtotal_material, subtotal_labor
        )
        line_count = sum(
            len(image_estimate.lines)
            for image_estimate in image_estimates
        )
        logger.info(
            f"Calculate project estimate completed: "
            f"image_count: {len(image_estimates)} | "
            f"line_count: {line_count} | "
            f"subtotal_material: {subtotal_material} | "
            f"subtotal_labor: {subtotal_labor} | "
            f"contingency: {contingency} | grand_total: {grand_total}"
        )
        return CalculatedProjectEstimate(
            images=image_estimates,
            subtotal_material=subtotal_material,
            subtotal_labor=subtotal_labor,
            contingency=contingency,
            grand_total=grand_total,
        )

    def _calculate_lines(
        self,
        width: int,
        height: int,
        calibration: ImageCalibration | None,
        regions: list[ImageRegion],
    ) -> list[CalculatedLine]:
        logger.debug(
            f"Calculate estimate lines: width: {width} | height: {height} | "
            f"region_count: {len(regions)}"
        )
        scale_ft_per_px = (
            self.measurement_service.calculate_scale_ft_per_px(
                calibration, width, height
            )
            if calibration is not None
            else None
        )

        lines: list[CalculatedLine] = []
        for region in regions:
            if region.region_role != RegionRole.FINISH.value:
                continue

            material = self._find_region_material(region)
            final_measure, measure_unit = (
                self.measurement_service.calculate_final_measure(
                    region, width, height, scale_ft_per_px
                )
            )
            purchase_qty = self.quantity_service.calculate_purchase_quantity(
                material, final_measure
            )
            material_rate = _select_effective_rate(
                region.material_rate_override, material.material_rate
            )
            labor_rate = _select_effective_rate(
                region.labor_rate_override, material.labor_rate
            )
            material_cost = _round_up_to_rupee(
                purchase_qty * material_rate
            )
            labor_cost = _round_up_to_rupee(final_measure * labor_rate)

            line_total = material_cost + labor_cost
            lines.append(
                CalculatedLine(
                    region_id=region.id,
                    region_name=region.name,
                    material_name=material.name,
                    material_category=material.category,
                    final_measure=final_measure,
                    measure_unit=measure_unit,
                    waste_pct=Decimal(str(material.waste_pct)),
                    purchase_qty=purchase_qty,
                    purchase_unit=material.unit,
                    material_rate=material_rate,
                    labor_rate=labor_rate,
                    material_cost=material_cost,
                    labor_cost=labor_cost,
                    line_total=line_total,
                )
            )
            logger.debug(
                f"Estimate line: region_id: {region.id} | "
                f"material_id: {material.id} | "
                f"final_measure: {final_measure} | "
                f"measure_unit: {measure_unit} | "
                f"purchase_qty: {purchase_qty} | "
                f"purchase_unit: {material.unit} | "
                f"material_cost: {material_cost} | "
                f"labor_cost: {labor_cost} | line_total: {line_total}"
            )
        logger.debug(
            f"Calculate estimate lines completed: "
            f"line_count: {len(lines)}"
        )
        return lines

    def _find_region_material(
        self, region: ImageRegion
    ) -> MaterialResponse:
        if region.material_id is None:
            raise ApiError(
                status_code=422,
                code="UNASSIGNED_FINISH",
                message=(
                    f"Assign a material to '{region.name}' before estimating."
                ),
            )

        material = self.material_service.find_material(region.material_id)
        if material is None:
            raise ApiError(
                status_code=422,
                code="MATERIAL_UNKNOWN",
                message=(
                    f"The material on '{region.name}' is not in the catalog. "
                    "Choose another material."
                ),
            )

        if region.surface_type not in material.surfaces:
            raise ApiError(
                status_code=422,
                code="MATERIAL_NOT_APPLICABLE",
                message=(
                    f"The material on '{region.name}' does not apply to "
                    "its surface. Choose another material."
                ),
            )
        return material


def _build_image_response(
    lines: list[CalculatedLine],
) -> ImageEstimateResponse:
    subtotal_material, subtotal_labor = _sum_line_costs(lines)
    contingency, grand_total = _calculate_contingency(
        subtotal_material, subtotal_labor
    )
    return ImageEstimateResponse(
        contingency_pct=CONTINGENCY_PCT,
        lines=[_to_line_response(line) for line in lines],
        subtotal_material=float(subtotal_material),
        subtotal_labor=float(subtotal_labor),
        contingency=float(contingency),
        grand_total=float(grand_total),
    )


def _build_project_response(
    estimate: CalculatedProjectEstimate,
) -> ProjectEstimateResponse:
    return ProjectEstimateResponse(
        contingency_pct=CONTINGENCY_PCT,
        images=[
            ProjectImageEstimateResponse(
                image_id=image.image_id,
                subtotal_material=float(image.subtotal_material),
                subtotal_labor=float(image.subtotal_labor),
            )
            for image in estimate.images
        ],
        subtotal_material=float(estimate.subtotal_material),
        subtotal_labor=float(estimate.subtotal_labor),
        contingency=float(estimate.contingency),
        grand_total=float(estimate.grand_total),
    )


def _sum_line_costs(
    lines: list[CalculatedLine],
) -> tuple[Decimal, Decimal]:
    subtotal_material = sum(
        (line.material_cost for line in lines), _ZERO
    )
    subtotal_labor = sum((line.labor_cost for line in lines), _ZERO)
    return (
        subtotal_material.quantize(_CENT, rounding=ROUND_HALF_UP),
        subtotal_labor.quantize(_CENT, rounding=ROUND_HALF_UP),
    )


def _calculate_contingency(
    subtotal_material: Decimal, subtotal_labor: Decimal
) -> tuple[Decimal, Decimal]:
    subtotal = subtotal_material + subtotal_labor
    contingency = (subtotal * CONTINGENCY_RATE).quantize(
        _CENT, rounding=ROUND_HALF_UP
    )
    grand_total = (subtotal + contingency).quantize(
        _CENT, rounding=ROUND_HALF_UP
    )
    return contingency, grand_total


def _select_effective_rate(
    override: Decimal | None, catalog_rate: float
) -> Decimal:
    if override is not None:
        return override
    return Decimal(str(catalog_rate))


def _round_up_to_rupee(amount: Decimal) -> Decimal:
    # Rounding up keeps an estimate from understating the bill; §7 expects
    # 642.67 × ₹26 to yield ₹16,710.
    return amount.quantize(_RUPEE, rounding=ROUND_CEILING)


def _to_line_response(line: CalculatedLine) -> EstimateLineResponse:
    return EstimateLineResponse(
        region_id=line.region_id,
        region_name=line.region_name,
        material_name=line.material_name,
        final_measure=float(line.final_measure),
        measure_unit=line.measure_unit,
        waste_pct=float(line.waste_pct),
        purchase_qty=float(line.purchase_qty),
        purchase_unit=line.purchase_unit,
        material_rate=float(line.material_rate),
        labor_rate=float(line.labor_rate),
        material_cost=float(line.material_cost),
        labor_cost=float(line.labor_cost),
        line_total=float(line.line_total),
    )
