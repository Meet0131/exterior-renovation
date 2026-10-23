from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.db.database import engine
from app.exceptions import ApiError, build_api_error_response, build_validation_error_response
from app.routes import router as api_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await engine.dispose()


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
app.add_exception_handler(ApiError, build_api_error_response)
app.add_exception_handler(RequestValidationError, build_validation_error_response)
app.include_router(api_router, prefix="/api")

# One container in production: FastAPI serves the built React app when it exists.
frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
