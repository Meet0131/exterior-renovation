from app.repositories.image_repository import ImageRepository
from app.repositories.project_repository import ProjectRepository
from app.services.estimate_service import EstimateService


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
