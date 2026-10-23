from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, Numeric, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base

if TYPE_CHECKING:
    from app.models.image import Image


class ImageCalibration(Base):
    __tablename__ = "image_calibrations"
    __table_args__ = (
        CheckConstraint(
            "length_ft > 0",
            name="ck_image_calibrations_length_ft_positive",
        ),
        CheckConstraint(
            "p1_x >= 0 AND p1_x <= 1 AND p1_y >= 0 AND p1_y <= 1 "
            "AND p2_x >= 0 AND p2_x <= 1 AND p2_y >= 0 AND p2_y <= 1",
            name="ck_image_calibrations_point_coordinates_unit",
        ),
        CheckConstraint(
            "p1_x <> p2_x OR p1_y <> p2_y",
            name="ck_image_calibrations_reference_points_distinct",
        ),
    )

    image_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey(
            "images.id",
            ondelete="CASCADE",
            name="fk_image_calibrations_image_id",
        ),
        primary_key=True,
    )
    length_ft: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    p1_x: Mapped[Decimal] = mapped_column(Numeric(6, 5), nullable=False)
    p1_y: Mapped[Decimal] = mapped_column(Numeric(6, 5), nullable=False)
    p2_x: Mapped[Decimal] = mapped_column(Numeric(6, 5), nullable=False)
    p2_y: Mapped[Decimal] = mapped_column(Numeric(6, 5), nullable=False)

    image: Mapped["Image"] = relationship(
        "Image", back_populates="calibration", lazy="raise"
    )
