import logging

from fastapi import APIRouter

from app.config import Config

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


@router.get("/health")
async def read_health() -> dict[str, str]:
    logger.debug(f"Health check requested: env: {Config.APP_ENV}")
    response = {
        "status": "ok",
        "service": Config.APP_NAME,
        "env": Config.APP_ENV,
    }
    logger.debug(
        f"Health check served: status: ok | env: {Config.APP_ENV}"
    )
    return response
