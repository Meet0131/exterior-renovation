from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.dto.common_dto import ErrorDetail, ErrorResponse


class ApiError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        field: str | None = None,
    ):
        self.status_code = status_code
        self.code = code
        self.message = message
        self.field = field
        super().__init__(message)


def build_api_error_response(_: Request, exc: ApiError) -> JSONResponse:
    body = ErrorResponse(
        error=ErrorDetail(code=exc.code, message=exc.message, field=exc.field)
    )
    return JSONResponse(
        status_code=exc.status_code,
        content=body.model_dump(exclude_none=True),
    )


def build_validation_error_response(
    _: Request, exc: RequestValidationError
) -> JSONResponse:
    errors = exc.errors()
    error = errors[0] if errors else {}
    body = ErrorResponse(
        error=ErrorDetail(
            code="VALIDATION_ERROR",
            message=error.get("msg", "The request is invalid."),
            field=_format_validation_field(error.get("loc", ())),
        )
    )
    return JSONResponse(
        status_code=422,
        content=body.model_dump(exclude_none=True),
    )


def _format_validation_field(loc: tuple[str | int, ...]) -> str | None:
    parts = [str(part) for part in loc]
    if parts and parts[0] in {"body", "path", "query", "header", "cookie"}:
        parts = parts[1:]
    return ".".join(parts) if parts else None
