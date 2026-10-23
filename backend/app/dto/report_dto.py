from dataclasses import dataclass


@dataclass(frozen=True)
class ReportFile:
    content: bytes
    filename: str
