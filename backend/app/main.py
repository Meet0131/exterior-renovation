import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.staticfiles import StaticFiles

from app.config import Config
from app.utils.logging import setup_logging

setup_logging()

from app.db.database import engine  # noqa: E402
from app.exceptions import (  # noqa: E402
    ApiError,
    build_api_error_response,
    build_internal_error_response,
    build_validation_error_response,
)
from app.middleware.request_id import request_id_middleware  # noqa: E402
from app.middleware.timing import timing_middleware  # noqa: E402
from app.routes import router as api_router  # noqa: E402

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info(
        f"Application starting: name: {Config.APP_NAME} | "
        f"env: {Config.APP_ENV}"
    )
    try:
        yield
    finally:
        logger.info("Application shutting down")
        await engine.dispose()
        logger.info("Application stopped")


app = FastAPI(title=Config.APP_NAME, version="0.1.0", lifespan=lifespan)
app.add_exception_handler(ApiError, build_api_error_response)
app.add_exception_handler(
    RequestValidationError, build_validation_error_response
)
app.add_exception_handler(Exception, build_internal_error_response)
app.include_router(api_router, prefix="/api")

# Last registered is outermost: request_id wraps timing so every log has an ID.
app.middleware("http")(timing_middleware)
app.middleware("http")(request_id_middleware)

# One container in production: FastAPI serves the built React app when it exists.
frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
