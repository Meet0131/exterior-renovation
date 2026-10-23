from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    Text,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.constants.constants import DEFAULT_SORT_ORDER
from app.db.database import Base
from app.enums.region_role import RegionRole

if TYPE_CHECKING:
    from app.models.image import Image


class ImageRegion(Base):
    __tablename__ = "image_regions"
    __table_args__ = (
        Index("ix_image_regions_image_id_sort_order", "image_id", "sort_order"),
        CheckConstraint(
            "deduction_sqft >= 0",
            name="ck_image_regions_deduction_sqft_non_negative",
        ),
        CheckConstraint(
            "material_rate_override IS NULL OR material_rate_override >= 0",
            name="ck_image_regions_material_rate_override_non_negative",
        ),
        CheckConstraint(
            "labor_rate_override IS NULL OR labor_rate_override >= 0",
            name="ck_image_regions_labor_rate_override_non_negative",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid4
    )
    image_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey(
            "images.id",
            ondelete="CASCADE",
            name="fk_image_regions_image_id",
        ),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=DEFAULT_SORT_ORDER
    )
    geometry_type: Mapped[str] = mapped_column(Text, nullable=False)
    geometry_json: Mapped[list[dict[str, float]]] = mapped_column(
        JSONB, nullable=False
    )
    surface_type: Mapped[str] = mapped_column(Text, nullable=False)
    region_role: Mapped[str] = mapped_column(
        Text, nullable=False, default=RegionRole.FINISH.value
    )
    manual_area_sqft: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 2), nullable=True
    )
    manual_length_ft: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 2), nullable=True
    )
    deduction_sqft: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=Decimal("0")
    )
    material_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    color_hex: Mapped[str | None] = mapped_column(Text, nullable=True)
    material_rate_override: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    labor_rate_override: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2), nullable=True
    )

    image: Mapped["Image"] = relationship(
        "Image", back_populates="regions", lazy="raise"
    )
