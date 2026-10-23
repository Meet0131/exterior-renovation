from enum import StrEnum


class SurfaceType(StrEnum):
    WALL = "wall"
    PILLAR = "pillar"
    PARAPET = "parapet"
    RAILING = "railing"
    BALCONY_SLAB = "balcony_slab"
    GATE = "gate"
    ROOF_EDGE = "roof_edge"
    TRIM = "trim"
    WINDOW = "window"
    DOOR = "door"
