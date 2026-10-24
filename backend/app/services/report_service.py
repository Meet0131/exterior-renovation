import asyncio
import logging
import re
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from io import BytesIO
from pathlib import Path
from uuid import UUID
from xml.sax.saxutils import escape

from PIL import Image as PillowImage
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image as ReportImage,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from starlette.concurrency import run_in_threadpool

from app.constants.constants import (
    CONTINGENCY_PCT,
    REPORT_IMAGE_MAX_LONG_SIDE_PX,
    REPORT_TIMEOUT_SECONDS,
)
from app.dto.report_dto import ReportFile
from app.exceptions import ApiError
from app.models.image import Image
from app.models.project import Project
from app.repositories.image_repository import ImageRepository
from app.repositories.project_repository import ProjectRepository
from app.services.estimate_service import (
    CalculatedImageEstimate,
    CalculatedLine,
    CalculatedProjectEstimate,
    EstimateService,
)

logger = logging.getLogger(__name__)

_PAGE_MARGIN = 36.0
_CONTENT_WIDTH = A4[0] - 2 * _PAGE_MARGIN
_ZERO = Decimal("0")

_FONT_PAIRS = (
    (
        "DejaVuSans",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ),
    (
        "FreeSans",
        "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
    ),
    (
        "NotoSans",
        "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
        "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
    ),
)

_COST_COLUMN_WIDTHS = (102, 102, 56, 35, 60, 56, 56, 56)
_CATEGORY_COLUMN_WIDTHS = (180, 110, 110, 110)


@dataclass(frozen=True)
class _ReportFonts:
    regular: str
    bold: str
    currency_prefix: str


def _register_report_fonts() -> _ReportFonts:
    for family, regular_path, bold_path in _FONT_PAIRS:
        if not (Path(regular_path).is_file() and Path(bold_path).is_file()):
            continue
        try:
            regular_name = family
            bold_name = f"{family}-Bold"
            pdfmetrics.registerFont(TTFont(regular_name, regular_path))
            pdfmetrics.registerFont(TTFont(bold_name, bold_path))
            pdfmetrics.registerFontFamily(
                family,
                normal=regular_name,
                bold=bold_name,
                italic=regular_name,
                boldItalic=bold_name,
            )
            return _ReportFonts(regular_name, bold_name, "₹")
        except Exception:
            logger.warning(
                f"Could not register report font: family: {family}",
                exc_info=True,
            )
    return _ReportFonts("Helvetica", "Helvetica-Bold", "Rs. ")


_FONTS = _register_report_fonts()


class ReportService:
    """Builds the PDF report from stored final previews and current estimates."""

    def __init__(
        self,
        project_repository: ProjectRepository,
        image_repository: ImageRepository,
        estimate_service: EstimateService,
    ):
        self.project_repository = project_repository
        self.image_repository = image_repository
        self.estimate_service = estimate_service

    async def get_project_report(self, project_id: UUID) -> ReportFile:
        logger.info(f"Generate report started: project_id: {project_id}")
        project = await self.project_repository.get_by_id(project_id)
        if project is None:
            raise ApiError(
                status_code=404,
                code="PROJECT_NOT_FOUND",
                message="Project not found.",
            )

        images = await self.image_repository.get_for_project_with_report_data(
            project_id
        )
        logger.debug(
            f"Report images loaded: project_id: {project_id} | "
            f"image_count: {len(images)}"
        )
        missing_preview_count = sum(
            1 for image in images if image.final_preview_bytes is None
        )
        if missing_preview_count:
            logger.warning(
                f"Report blocked: project_id: {project_id} | "
                f"image_count: {len(images)} | "
                f"missing_preview_count: {missing_preview_count}"
            )
            raise ApiError(
                status_code=422,
                code="FINAL_PREVIEW_REQUIRED",
                message="Continue to estimate before generating the report.",
            )

        estimate = self.estimate_service.calculate_project_estimate(images)
        line_count = sum(
            len(image_estimate.lines)
            for image_estimate in estimate.images
        )
        logger.debug(
            f"Report estimate calculated: project_id: {project_id} | "
            f"line_count: {line_count} | grand_total: {estimate.grand_total}"
        )

        start = time.perf_counter()
        try:
            content = await asyncio.wait_for(
                run_in_threadpool(
                    _render_report_pdf, project, images, estimate
                ),
                timeout=REPORT_TIMEOUT_SECONDS,
            )
        except TimeoutError:
            duration_ms = (time.perf_counter() - start) * 1000
            logger.warning(
                f"Report render timed out: project_id: {project_id} | "
                f"timeout_seconds: {REPORT_TIMEOUT_SECONDS} | "
                f"duration_ms: {duration_ms:.2f}"
            )
            raise ApiError(
                status_code=503,
                code="REPORT_UNAVAILABLE",
                message="Report generation failed. Try again.",
            )
        except Exception:
            logger.exception(
                f"Report render failed: project_id: {project_id}"
            )
            raise ApiError(
                status_code=503,
                code="REPORT_UNAVAILABLE",
                message="Report generation failed. Try again.",
            )

        duration_ms = (time.perf_counter() - start) * 1000
        logger.info(
            f"Generate report completed: project_id: {project_id} | "
            f"size_bytes: {len(content)} | duration_ms: {duration_ms:.2f}"
        )
        return ReportFile(
            content=content, filename=_build_report_filename(project.title)
        )


def _render_report_pdf(
    project: Project,
    images: list[Image],
    estimate: CalculatedProjectEstimate,
) -> bytes:
    logger.info(
        f"Render report PDF started: project_id: {project.id} | "
        f"image_count: {len(images)}"
    )
    start = time.perf_counter()
    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=_PAGE_MARGIN,
        rightMargin=_PAGE_MARGIN,
        topMargin=_PAGE_MARGIN,
        bottomMargin=_PAGE_MARGIN + 10,
        title=project.title,
        author="RenoVision Exterior Renovation Planner",
        subject="Exterior renovation estimate",
    )
    styles = _build_styles(_FONTS)
    story = _build_story(project, images, estimate, styles)
    document.build(
        story,
        onFirstPage=lambda canvas, doc: _draw_footer(canvas, _FONTS),
        onLaterPages=lambda canvas, doc: _draw_footer(canvas, _FONTS),
    )
    content = buffer.getvalue()
    duration_ms = (time.perf_counter() - start) * 1000
    logger.info(
        f"Render report PDF completed: project_id: {project.id} | "
        f"size_bytes: {len(content)} | duration_ms: {duration_ms:.2f}"
    )
    return content


def _build_story(
    project: Project,
    images: list[Image],
    estimate: CalculatedProjectEstimate,
    styles: dict[str, ParagraphStyle],
) -> list:
    story = [
        Paragraph(escape(project.title), styles["title"]),
        Paragraph(
            f"Exterior renovation estimate &#183; "
            f"Prepared {_format_report_date()}",
            styles["subtitle"],
        ),
    ]

    if not images:
        story.append(
            Paragraph(
                "No photos are saved on this project yet.",
                styles["body"],
            )
        )

    for index, (image, image_estimate) in enumerate(
        zip(images, estimate.images), start=1
    ):
        if index > 1:
            story.append(PageBreak())
        story.extend(
            _build_photo_section(
                index, len(images), image, image_estimate, styles
            )
        )

    story.extend(_build_summary(estimate, styles))
    return story


def _build_photo_section(
    index: int,
    total: int,
    image: Image,
    image_estimate: CalculatedImageEstimate,
    styles: dict[str, ParagraphStyle],
) -> list:
    flow = [
        Spacer(1, 12),
        Paragraph(f"Photo {index} of {total}", styles["photo"]),
        _build_photo_grid(image, styles),
        Spacer(1, 6),
        Paragraph(_build_calibration_note(image), styles["small"]),
        Spacer(1, 8),
    ]

    if image_estimate.lines:
        flow.append(_build_cost_table(image_estimate.lines, styles))
        flow.append(Spacer(1, 6))
    else:
        flow.append(
            Paragraph("No costed regions on this photo.", styles["body"])
        )

    flow.append(
        Paragraph(
            "Photo subtotal: material "
            f"{_format_money(image_estimate.subtotal_material)} &#183; "
            f"labour {_format_money(image_estimate.subtotal_labor)}",
            styles["body"],
        )
    )
    return flow


def _build_photo_grid(
    image: Image, styles: dict[str, ParagraphStyle]
) -> Table:
    photo_width = _CONTENT_WIDTH / 2 - 10
    source = _make_photo_flowable(
        image.bytes, max_width=photo_width, max_height=190
    )
    preview = _make_photo_flowable(
        image.final_preview_bytes, max_width=photo_width, max_height=190
    )
    grid = Table(
        [
            [source, preview],
            [
                Paragraph("Original photo", styles["caption"]),
                Paragraph("Proposed design", styles["caption"]),
            ],
        ],
        colWidths=[_CONTENT_WIDTH / 2, _CONTENT_WIDTH / 2],
    )
    grid.setStyle(
        TableStyle(
            [
                ("ALIGN", (0, 0), (-1, 0), "CENTER"),
                ("VALIGN", (0, 0), (-1, 0), "MIDDLE"),
                ("ALIGN", (0, 1), (-1, 1), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, 0), 2),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 4),
                ("TOPPADDING", (0, 1), (-1, 1), 0),
            ]
        )
    )
    return grid


def _make_photo_flowable(
    content: bytes | None, max_width: float, max_height: float
) -> ReportImage:
    if content is None:
        raise ValueError("Report image is missing.")
    with PillowImage.open(BytesIO(content)) as source:
        photo = source.convert("RGB")
        photo.thumbnail(
            (
                REPORT_IMAGE_MAX_LONG_SIDE_PX,
                REPORT_IMAGE_MAX_LONG_SIDE_PX,
            ),
            PillowImage.Resampling.LANCZOS,
        )
        width, height = photo.size
        buffer = BytesIO()
        photo.save(buffer, format="JPEG", quality=92)

    scale = min(max_width / width, max_height / height)
    buffer.seek(0)
    return ReportImage(
        buffer,
        width=width * scale,
        height=height * scale,
    )


def _build_calibration_note(image: Image) -> str:
    if image.calibration is None:
        return (
            "No calibration is saved for this photo; manual measures were "
            "used where provided."
        )
    return (
        f"Scale reference: {image.calibration.length_ft:.2f} ft. "
        "A 3% reference mistake becomes about a 6% area error."
    )


def _build_cost_table(
    lines: list[CalculatedLine], styles: dict[str, ParagraphStyle]
) -> Table:
    rows = [
        [
            _header_cell("Region", styles),
            _header_cell("Material", styles),
            _header_cell("Measure", styles),
            _header_cell("Waste", styles),
            _header_cell("Quantity", styles),
            _header_cell("Material cost", styles),
            _header_cell("Labour cost", styles),
            _header_cell("Amount", styles),
        ]
    ]
    for line in lines:
        rows.append(
            [
                Paragraph(escape(line.region_name), styles["table_cell"]),
                Paragraph(
                    escape(line.material_name), styles["table_cell"]
                ),
                _number_cell(
                    _format_indian_number(
                        line.final_measure, 1, trim_trailing_zeros=True
                    )
                    + f" {line.measure_unit}",
                    styles,
                ),
                _number_cell(f"{line.waste_pct:g}%", styles),
                _number_cell(
                    _format_indian_number(
                        line.purchase_qty, 1, trim_trailing_zeros=True
                    )
                    + f" {line.purchase_unit}",
                    styles,
                ),
                _number_cell(_format_money(line.material_cost), styles),
                _number_cell(_format_money(line.labor_cost), styles),
                _number_cell(_format_money(line.line_total), styles),
            ]
        )

    table = Table(
        rows, colWidths=_COST_COLUMN_WIDTHS, repeatRows=1
    )
    _style_data_table(table)
    return table


def _build_summary(
    estimate: CalculatedProjectEstimate,
    styles: dict[str, ParagraphStyle],
) -> list:
    flow = [
        Spacer(1, 14),
        Paragraph("Summary", styles["section"]),
    ]
    categories = _calculate_category_totals(estimate)

    if categories:
        rows = [
            [
                _header_cell("Category", styles),
                _header_cell("Material", styles),
                _header_cell("Labour", styles),
                _header_cell("Total", styles),
            ]
        ]
        for category, material, labour in categories:
            rows.append(
                [
                    Paragraph(
                        _format_category(category), styles["table_cell"]
                    ),
                    _number_cell(_format_money(material), styles),
                    _number_cell(_format_money(labour), styles),
                    _number_cell(_format_money(material + labour), styles),
                ]
            )
        table = Table(
            rows,
            colWidths=_CATEGORY_COLUMN_WIDTHS,
            repeatRows=1,
        )
        _style_data_table(table)
        flow.extend([table, Spacer(1, 10)])
    else:
        flow.append(
            Paragraph(
                "No costed regions are included in this report.",
                styles["body"],
            )
        )
        flow.append(Spacer(1, 6))

    totals = Table(
        [
            [
                Paragraph("Subtotal material", styles["summary_label"]),
                _summary_value(
                    _format_money(estimate.subtotal_material), styles
                ),
            ],
            [
                Paragraph("Subtotal labour", styles["summary_label"]),
                _summary_value(
                    _format_money(estimate.subtotal_labor), styles
                ),
            ],
            [
                Paragraph(
                    f"Contingency ({CONTINGENCY_PCT:g}%)",
                    styles["summary_label"],
                ),
                _summary_value(
                    _format_money(estimate.contingency), styles
                ),
            ],
            [
                Paragraph("Grand total", styles["grand_label"]),
                _summary_value(
                    _format_money(estimate.grand_total), styles, grand=True
                ),
            ],
        ],
        colWidths=[_CONTENT_WIDTH - 140, 140],
    )
    totals.setStyle(
        TableStyle(
            [
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LINEABOVE", (0, 0), (-1, 0), 0.5, colors.HexColor("#d1d5db")),
                ("LINEBELOW", (0, -1), (-1, -1), 0.8, colors.HexColor("#9ca3af")),
                ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#f3f4f6")),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    flow.append(totals)
    return [KeepTogether(flow)]


def _calculate_category_totals(
    estimate: CalculatedProjectEstimate,
) -> list[tuple[str, Decimal, Decimal]]:
    totals: dict[str, tuple[Decimal, Decimal]] = {}
    for image in estimate.images:
        for line in image.lines:
            material, labour = totals.get(
                line.material_category, (_ZERO, _ZERO)
            )
            totals[line.material_category] = (
                material + line.material_cost,
                labour + line.labor_cost,
            )
    return [
        (category, material, labour)
        for category, (material, labour) in sorted(totals.items())
    ]


def _build_styles(
    fonts: _ReportFonts,
) -> dict[str, ParagraphStyle]:
    return {
        "title": ParagraphStyle(
            "ReportTitle",
            fontName=fonts.bold,
            fontSize=19,
            leading=23,
            textColor=colors.HexColor("#111827"),
            spaceAfter=3,
        ),
        "subtitle": ParagraphStyle(
            "ReportSubtitle",
            fontName=fonts.regular,
            fontSize=9,
            leading=12,
            textColor=colors.HexColor("#6b7280"),
            spaceAfter=10,
        ),
        "callout": ParagraphStyle(
            "ReportCallout",
            fontName=fonts.regular,
            fontSize=8,
            leading=11,
            textColor=colors.HexColor("#92400e"),
        ),
        "section": ParagraphStyle(
            "ReportSection",
            fontName=fonts.bold,
            fontSize=13,
            leading=16,
            textColor=colors.HexColor("#111827"),
            spaceBefore=4,
            spaceAfter=6,
        ),
        "photo": ParagraphStyle(
            "ReportPhoto",
            fontName=fonts.bold,
            fontSize=11,
            leading=14,
            textColor=colors.HexColor("#111827"),
            spaceAfter=6,
        ),
        "body": ParagraphStyle(
            "ReportBody",
            fontName=fonts.regular,
            fontSize=8.5,
            leading=11.5,
            textColor=colors.HexColor("#374151"),
        ),
        "small": ParagraphStyle(
            "ReportSmall",
            fontName=fonts.regular,
            fontSize=7.5,
            leading=10,
            textColor=colors.HexColor("#6b7280"),
        ),
        "caption": ParagraphStyle(
            "ReportCaption",
            fontName=fonts.regular,
            fontSize=7.5,
            leading=10,
            textColor=colors.HexColor("#6b7280"),
            alignment=TA_CENTER,
        ),
        "table_header": ParagraphStyle(
            "ReportTableHeader",
            fontName=fonts.bold,
            fontSize=6.8,
            leading=8,
            textColor=colors.white,
            alignment=TA_CENTER,
        ),
        "table_cell": ParagraphStyle(
            "ReportTableCell",
            fontName=fonts.regular,
            fontSize=7,
            leading=8.6,
            textColor=colors.HexColor("#111827"),
        ),
        "table_number": ParagraphStyle(
            "ReportTableNumber",
            fontName=fonts.regular,
            fontSize=7,
            leading=8.6,
            textColor=colors.HexColor("#111827"),
            alignment=TA_RIGHT,
        ),
        "summary_label": ParagraphStyle(
            "ReportSummaryLabel",
            fontName=fonts.regular,
            fontSize=8.5,
            leading=11,
            textColor=colors.HexColor("#374151"),
        ),
        "summary_value": ParagraphStyle(
            "ReportSummaryValue",
            fontName=fonts.regular,
            fontSize=8.5,
            leading=11,
            textColor=colors.HexColor("#111827"),
            alignment=TA_RIGHT,
        ),
        "grand_label": ParagraphStyle(
            "ReportGrandLabel",
            fontName=fonts.bold,
            fontSize=10,
            leading=13,
            textColor=colors.HexColor("#111827"),
        ),
        "grand_value": ParagraphStyle(
            "ReportGrandValue",
            fontName=fonts.bold,
            fontSize=10,
            leading=13,
            textColor=colors.HexColor("#111827"),
            alignment=TA_RIGHT,
        ),
        "bullet": ParagraphStyle(
            "ReportBullet",
            fontName=fonts.regular,
            fontSize=8,
            leading=11,
            leftIndent=10,
            bulletIndent=0,
            textColor=colors.HexColor("#374151"),
            spaceAfter=3,
        ),
    }


def _header_cell(
    text: str, styles: dict[str, ParagraphStyle]
) -> Paragraph:
    return Paragraph(text, styles["table_header"])


def _number_cell(
    text: str, styles: dict[str, ParagraphStyle]
) -> Paragraph:
    return Paragraph(escape(text), styles["table_number"])


def _summary_value(
    text: str,
    styles: dict[str, ParagraphStyle],
    grand: bool = False,
) -> Paragraph:
    return Paragraph(
        escape(text), styles["grand_value" if grand else "summary_value"]
    )


def _style_data_table(table: Table) -> None:
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f2937")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                (
                    "ROWBACKGROUNDS",
                    (0, 1),
                    (-1, -1),
                    [colors.white, colors.HexColor("#f9fafb")],
                ),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e5e7eb")),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )


def _draw_footer(canvas, fonts: _ReportFonts) -> None:
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#e5e7eb"))
    canvas.setLineWidth(0.5)
    canvas.line(
        _PAGE_MARGIN, 30, A4[0] - _PAGE_MARGIN, 30
    )
    canvas.setFont(fonts.regular, 7)
    canvas.setFillColor(colors.HexColor("#6b7280"))
    canvas.drawString(
        _PAGE_MARGIN, 20, "RenoVision Exterior Renovation Planner"
    )
    canvas.drawRightString(
        A4[0] - _PAGE_MARGIN, 20, f"Page {canvas.getPageNumber()}"
    )
    canvas.restoreState()


def _group_indian_digits(digits: str) -> str:
    if len(digits) <= 3:
        return digits
    head, tail = digits[:-3], digits[-3:]
    groups = [tail]
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return ",".join(groups)


def _format_indian_number(
    value: Decimal, places: int, trim_trailing_zeros: bool = False
) -> str:
    text = f"{abs(value):.{places}f}"
    whole, _, fraction = text.partition(".")
    if trim_trailing_zeros and fraction:
        fraction = fraction.rstrip("0")
    grouped = _group_indian_digits(whole)
    if fraction:
        grouped = f"{grouped}.{fraction}"
    return f"-{grouped}" if value < 0 else grouped


def _format_money(value: Decimal) -> str:
    paise = int((value * 100).to_integral_value(rounding=ROUND_HALF_UP))
    places = 2 if paise % 100 else 0
    rounded = Decimal(paise) / 100
    return (
        f"{_FONTS.currency_prefix}"
        f"{_format_indian_number(rounded, places)}"
    )


def _format_category(category: str) -> str:
    return category.replace("_", " ").title()


def _format_report_date() -> str:
    return datetime.now(timezone.utc).strftime("%d %B %Y")


def _build_report_filename(title: str) -> str:
    normalized = unicodedata.normalize("NFKD", title)
    ascii_title = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_title).strip("-").lower()
    return f"{slug or 'project'}.pdf"
