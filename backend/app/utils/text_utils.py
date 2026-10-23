def str_to_bool(value: str | None) -> bool:
    return str(value).lower() in ("true", "1", "yes")
