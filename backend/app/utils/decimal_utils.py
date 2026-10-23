from decimal import Decimal, ROUND_HALF_UP


def convert_to_decimal(value: float, exponent: str) -> Decimal:
    return Decimal(str(value)).quantize(
        Decimal(exponent),
        rounding=ROUND_HALF_UP,
    )


def convert_optional_to_decimal(
    value: float | None, exponent: str
) -> Decimal | None:
    if value is None:
        return None
    return convert_to_decimal(value, exponent)
