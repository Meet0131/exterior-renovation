from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.constants.constants import DEFAULT_PROJECT_TITLE
from app.db.database import Base
from app.utils.time_utils import utc_now

if TYPE_CHECKING:
    from app.models.image import Image


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid4
    )
    title: Mapped[str] = mapped_column(
        Text, nullable=False, default=DEFAULT_PROJECT_TITLE
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )

    images: Mapped[list["Image"]] = relationship(
        "Image",
        back_populates="project",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="Image.sort_order, Image.id",
        lazy="raise",
    )
