from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CalibrationPayload(BaseModel):
    length_ft: float = Field(
        gt=0, le=99_999_999.99, allow_inf_nan=False
    )
    p1_x: float = Field(ge=0, le=1, allow_inf_nan=False)
    p1_y: float = Field(ge=0, le=1, allow_inf_nan=False)
    p2_x: float = Field(ge=0, le=1, allow_inf_nan=False)
    p2_y: float = Field(ge=0, le=1, allow_inf_nan=False)

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    @model_validator(mode="after")
    def validate_reference_points_differ(self) -> "CalibrationPayload":
        if self.p1_x == self.p2_x and self.p1_y == self.p2_y:
            raise ValueError("The two reference points must differ.")
        return self


class CalibrationResponse(CalibrationPayload):
    image_id: UUID
