"""create initial schema

Revision ID: 20261023000001
Revises:
Create Date: 2026-10-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20261023000001"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "projects",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "images",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("bytes", sa.LargeBinary(), nullable=False),
        sa.Column(
            "ai_detection_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("final_preview_bytes", sa.LargeBinary(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name="fk_images_project_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_images_project_id_sort_order",
        "images",
        ["project_id", "sort_order"],
        unique=False,
    )

    op.create_table(
        "image_calibrations",
        sa.Column("image_id", sa.Uuid(), nullable=False),
        sa.Column("length_ft", sa.Numeric(10, 2), nullable=False),
        sa.Column("p1_x", sa.Numeric(6, 5), nullable=False),
        sa.Column("p1_y", sa.Numeric(6, 5), nullable=False),
        sa.Column("p2_x", sa.Numeric(6, 5), nullable=False),
        sa.Column("p2_y", sa.Numeric(6, 5), nullable=False),
        sa.CheckConstraint(
            "length_ft > 0",
            name="ck_image_calibrations_length_ft_positive",
        ),
        sa.CheckConstraint(
            "p1_x >= 0 AND p1_x <= 1 AND p1_y >= 0 AND p1_y <= 1 "
            "AND p2_x >= 0 AND p2_x <= 1 AND p2_y >= 0 AND p2_y <= 1",
            name="ck_image_calibrations_point_coordinates_unit",
        ),
        sa.CheckConstraint(
            "p1_x <> p2_x OR p1_y <> p2_y",
            name="ck_image_calibrations_reference_points_distinct",
        ),
        sa.ForeignKeyConstraint(
            ["image_id"],
            ["images.id"],
            name="fk_image_calibrations_image_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("image_id"),
    )

    op.create_table(
        "image_regions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("image_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("geometry_type", sa.Text(), nullable=False),
        sa.Column(
            "geometry_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("surface_type", sa.Text(), nullable=False),
        sa.Column("region_role", sa.Text(), nullable=False),
        sa.Column("manual_area_sqft", sa.Numeric(10, 2), nullable=True),
        sa.Column("manual_length_ft", sa.Numeric(10, 2), nullable=True),
        sa.Column("deduction_sqft", sa.Numeric(10, 2), nullable=False),
        sa.Column("material_id", sa.Text(), nullable=True),
        sa.Column("color_hex", sa.Text(), nullable=True),
        sa.Column("material_rate_override", sa.Numeric(12, 2), nullable=True),
        sa.Column("labor_rate_override", sa.Numeric(12, 2), nullable=True),
        sa.CheckConstraint(
            "deduction_sqft >= 0",
            name="ck_image_regions_deduction_sqft_non_negative",
        ),
        sa.CheckConstraint(
            "material_rate_override IS NULL OR material_rate_override >= 0",
            name="ck_image_regions_material_rate_override_non_negative",
        ),
        sa.CheckConstraint(
            "labor_rate_override IS NULL OR labor_rate_override >= 0",
            name="ck_image_regions_labor_rate_override_non_negative",
        ),
        sa.ForeignKeyConstraint(
            ["image_id"],
            ["images.id"],
            name="fk_image_regions_image_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_image_regions_image_id_sort_order",
        "image_regions",
        ["image_id", "sort_order"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        "ix_image_regions_image_id_sort_order", table_name="image_regions"
    )
    op.drop_table("image_regions")
    op.drop_table("image_calibrations")
    op.drop_index("ix_images_project_id_sort_order", table_name="images")
    op.drop_table("images")
    op.drop_table("projects")
