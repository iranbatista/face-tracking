"""
errors.py — erros de negócio. Services levantam estes; o handler vira HTTP.

O corpo é {"detail": "..."}, o mesmo formato do HTTPException do FastAPI,
que o frontend já lê.
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    status_code = 400

    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


class Invalid(AppError):
    status_code = 400


class Unauthorized(AppError):
    status_code = 401


class NotFound(AppError):
    status_code = 404


class Gone(AppError):
    status_code = 410


class Unprocessable(AppError):
    status_code = 422


def install_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
