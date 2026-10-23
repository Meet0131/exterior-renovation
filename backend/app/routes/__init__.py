from fastapi import APIRouter

from app.routes.health_route import router as health_router
from app.routes.image_route import router as image_router
from app.routes.material_route import router as material_router
from app.routes.project_route import router as project_router

router = APIRouter()

router.include_router(health_router)
router.include_router(project_router, prefix="/projects", tags=["projects"])
router.include_router(image_router, prefix="/images", tags=["images"])
router.include_router(material_router, prefix="/materials", tags=["materials"])
