import json
import logging
from logging.config import dictConfig
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[2]


def setup_logging() -> None:
    config_path = _BACKEND_ROOT / "logging.json"
    with config_path.open(encoding="utf-8") as file:
        config = json.load(file)

    for handler in config.get("handlers", {}).values():
        filename = handler.get("filename")
        if not filename:
            continue
        log_path = Path(filename)
        if not log_path.is_absolute():
            log_path = _BACKEND_ROOT / log_path
        log_path.parent.mkdir(parents=True, exist_ok=True)
        handler["filename"] = str(log_path)

    dictConfig(config)
    logging.getLogger("sqlalchemy.engine.Engine").addHandler(
        logging.NullHandler()
    )
