from datetime import datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, Integer, LargeBinary, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.constants.constants import DEFAULT_SORT_ORDER
from app.db.database import Base
from app.utils.time_utils import utc_now

if TYPE_CHECKING:
    from app.models.image_calibration import ImageCalibration
    from app.models.image_region import ImageRegion
    from app.models.project import Project


class Image(Base):
    __tablename__ = "images"
    __table_args__ = (
        Index("ix_images_project_id_sort_order", "project_id", "sort_order"),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid4
    )
    project_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE", name="fk_images_project_id"),
        nullable=False,
    )
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=DEFAULT_SORT_ORDER
    )
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    bytes: Mapped[bytes] = mapped_column(
        "bytes", LargeBinary, nullable=False, deferred=True
    )
    ai_detection_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, nullable=True
    )
    final_preview_bytes: Mapped[bytes | None] = mapped_column(
        LargeBinary, nullable=True, deferred=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )

    project: Mapped["Project"] = relationship(
        "Project", back_populates="images", lazy="raise"
    )
    calibration: Mapped["ImageCalibration | None"] = relationship(
        "ImageCalibration",
        back_populates="image",
        uselist=False,
        cascade="all, delete-orphan",
        single_parent=True,
        passive_deletes=True,
        lazy="raise",
    )
    regions: Mapped[list["ImageRegion"]] = relationship(
        "ImageRegion",
        back_populates="image",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ImageRegion.sort_order, ImageRegion.id",
        lazy="raise",
    )
