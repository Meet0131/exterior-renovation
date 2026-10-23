import os
from pathlib import Path

from dotenv import load_dotenv

from app.utils.text_utils import str_to_bool

load_dotenv(Path(__file__).resolve().parents[1] / ".env")


class Config:
    APP_NAME = os.getenv("APP_NAME", "RenoVision Exterior Renovation")
    APP_ENV = os.getenv("APP_ENV", "development")

    DATABASE_URL = os.getenv("DATABASE_URL")
    DATABASE_ECHO = str_to_bool(os.getenv("DATABASE_ECHO", "false"))
    DATABASE_POOL_SIZE = int(os.getenv("DATABASE_POOL_SIZE", "5"))
    DATABASE_MAX_OVERFLOW = int(os.getenv("DATABASE_MAX_OVERFLOW", "10"))
    DATABASE_POOL_TIMEOUT = int(os.getenv("DATABASE_POOL_TIMEOUT", "30"))
    DATABASE_POOL_RECYCLE = int(os.getenv("DATABASE_POOL_RECYCLE", "1800"))

    ROBOFLOW_API_KEY = os.getenv("ROBOFLOW_API_KEY")
    ROBOFLOW_SAM3_URL = os.getenv(
        "ROBOFLOW_SAM3_URL",
        "https://serverless.roboflow.com/sam3/concept_segment",
    )

    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
    GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
    MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "10"))
    MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
