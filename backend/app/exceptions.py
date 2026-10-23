import logging

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.dto.common_dto import ErrorDetail, ErrorResponse

logger = logging.getLogger(__name__)


class ApiError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        field: str | None = None,
        headers: dict[str, str] | None = None,
    ):
        self.status_code = status_code
        self.code = code
        self.message = message
        self.field = field
        self.headers = headers
        super().__init__(message)


def build_api_error_response(
    request: Request, exc: ApiError
) -> JSONResponse:
    logger.warning(
        f"API error: method: {request.method} | path: {request.url.path} | "
        f"status: {exc.status_code} | code: {exc.code} | "
        f"field: {exc.field!r}"
    )
    body = ErrorResponse(
        error=ErrorDetail(code=exc.code, message=exc.message, field=exc.field)
    )
    response = JSONResponse(
        status_code=exc.status_code,
        content=body.model_dump(exclude_none=True),
        headers=exc.headers,
    )
    logger.debug(f"API error response sent: path: {request.url.path}")
    return response


def build_validation_error_response(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    errors = exc.errors()
    error = errors[0] if errors else {}
    field = _format_validation_field(error.get("loc", ()))
    logger.warning(
        f"Validation error: method: {request.method} | "
        f"path: {request.url.path} | error_count: {len(errors)} | "
        f"field: {field!r} | type: {error.get('type', 'unknown')}"
    )
    body = ErrorResponse(
        error=ErrorDetail(
            code="VALIDATION_ERROR",
            message=error.get("msg", "The request is invalid."),
            field=field,
        )
    )
    response = JSONResponse(
        status_code=422,
        content=body.model_dump(exclude_none=True),
    )
    logger.debug(f"Validation error response sent: path: {request.url.path}")
    return response


def build_internal_error_response(
    request: Request, exc: Exception
) -> JSONResponse:
    request_id = getattr(request.state, "request_id", "background")
    logger.error(
        f"Unhandled exception: method: {request.method} | "
        f"path: {request.url.path} | error_type: {type(exc).__name__}",
        exc_info=exc,
        extra={"request_id": request_id},
    )
    body = ErrorResponse(
        error=ErrorDetail(
            code="INTERNAL_ERROR",
            message="Something went wrong. Please try again later.",
        )
    )
    headers = (
        {"X-Request-ID": request_id}
        if request_id != "background"
        else None
    )
    response = JSONResponse(
        status_code=500,
        content=body.model_dump(exclude_none=True),
        headers=headers,
    )
    logger.debug(
        f"Internal error response sent: path: {request.url.path}",
        extra={"request_id": request_id},
    )
    return response


def _format_validation_field(loc: tuple[str | int, ...]) -> str | None:
    parts = [str(part) for part in loc]
    if parts and parts[0] in {"body", "path", "query", "header", "cookie"}:
        parts = parts[1:]
    return ".".join(parts) if parts else None
