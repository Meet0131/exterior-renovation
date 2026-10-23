import logging
import uuid
from contextvars import ContextVar

from fastapi import Request

request_id_var: ContextVar[str] = ContextVar(
    "request_id", default="background"
)

logger = logging.getLogger(__name__)


class RequestIDFilter(logging.Filter):
    """Injects the current request_id into every log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "request_id"):
            record.request_id = request_id_var.get()
        return True


async def request_id_middleware(request: Request, call_next):
    request_id = str(uuid.uuid4())
    token = request_id_var.set(request_id)
    request.state.request_id = request_id
    is_api_request = request.url.path.startswith("/api")
    status_code: int | str = "failed"

    if is_api_request:
        logger.debug(
            f"Request started: request_id: {request_id} | "
            f"method: {request.method} | path: {request.url.path}"
        )

    try:
        response = await call_next(request)
        status_code = response.status_code
        response.headers["X-Request-ID"] = request_id
        return response
    finally:
        if is_api_request:
            logger.debug(
                f"Request completed: request_id: {request_id} | "
                f"method: {request.method} | path: {request.url.path} | "
                f"status: {status_code}"
            )
        request_id_var.reset(token)
