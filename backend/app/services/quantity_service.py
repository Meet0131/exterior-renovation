import logging
import math
from decimal import Decimal, ROUND_HALF_UP

from app.dto.material_dto import MaterialResponse

logger = logging.getLogger(__name__)

_QUANTITY_QUANTUM = Decimal("0.01")
_BOX_UNIT = "box"
_ONE = Decimal("1")
_ZERO = Decimal("0")


class QuantityService:
    """Converts a final measure into a purchasable quantity."""

    def calculate_purchase_quantity(
        self, material: MaterialResponse, final_measure: Decimal
    ) -> Decimal:
        required = _calculate_required_quantity(material, final_measure)
        logger.debug(
            f"Calculate purchase quantity: material_id: {material.id} | "
            f"final_measure: {final_measure} | required: {required:.4f} | "
            f"coats: {material.coats} | "
            f"coverage_per_unit: {material.coverage_per_unit} | "
            f"waste_pct: {material.waste_pct}"
        )
        if required <= 0:
            purchase_qty = _ZERO.quantize(_QUANTITY_QUANTUM)
            logger.debug(
                f"Purchase quantity: material_id: {material.id} | "
                f"purchase_qty: {purchase_qty} | unit: {material.unit}"
            )
            return purchase_qty

        if material.pack_sizes:
            purchase_qty = _round_up_to_packs(
                required, material.pack_sizes
            )
        elif material.unit == _BOX_UNIT:
            purchase_qty = Decimal(math.ceil(required))
        else:
            purchase_qty = required.quantize(
                _QUANTITY_QUANTUM, rounding=ROUND_HALF_UP
            )
        logger.debug(
            f"Purchase quantity: material_id: {material.id} | "
            f"pack_sizes: {material.pack_sizes} | "
            f"purchase_qty: {purchase_qty} | unit: {material.unit}"
        )
        return purchase_qty


def _calculate_required_quantity(
    material: MaterialResponse, final_measure: Decimal
) -> Decimal:
    coverage = Decimal(str(material.coverage_per_unit))
    coats = Decimal(str(material.coats))
    waste = Decimal(str(material.waste_pct)) / Decimal("100")
    return final_measure * coats / coverage * (_ONE + waste)


def _round_up_to_packs(
    required: Decimal, pack_sizes: list[int]
) -> Decimal:
    packs = sorted(
        {int(size) for size in pack_sizes if size > 0}, reverse=True
    )
    if not packs:
        return required.quantize(
            _QUANTITY_QUANTUM, rounding=ROUND_HALF_UP
        )

    target = math.ceil(required)
    if target <= 0:
        return _ZERO.quantize(_QUANTITY_QUANTUM)
    if 1 in packs:
        return Decimal(target)

    largest = packs[0]
    upper_bound = math.ceil(target / largest) * largest
    reachable = [False] * (upper_bound + 1)
    reachable[0] = True
    for quantity in range(1, upper_bound + 1):
        reachable[quantity] = any(
            quantity >= pack and reachable[quantity - pack]
            for pack in packs
        )

    for quantity in range(target, upper_bound + 1):
        if reachable[quantity]:
            return Decimal(quantity)
    return Decimal(upper_bound)
