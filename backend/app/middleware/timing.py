import logging
import time

from fastapi import Request

logger = logging.getLogger(__name__)


async def timing_middleware(request: Request, call_next):
    if not request.url.path.startswith("/api"):
        return await call_next(request)

    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception as exc:
        duration_ms = (time.perf_counter() - start) * 1000
        logger.warning(
            f"Request failed: method: {request.method} | "
            f"path: {request.url.path} | status: failed | "
            f"duration_ms: {duration_ms:.2f} | "
            f"error_type: {type(exc).__name__}"
        )
        raise

    duration_ms = (time.perf_counter() - start) * 1000
    logger.info(
        f"Request completed: method: {request.method} | "
        f"path: {request.url.path} | status: {response.status_code} | "
        f"duration_ms: {duration_ms:.2f}"
    )
    return response
