from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CreateProjectRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1)

    model_config = ConfigDict(extra="forbid")


class UpdateProjectRequest(BaseModel):
    title: str = Field(min_length=1)

    model_config = ConfigDict(extra="forbid")


class ProjectImageResponse(BaseModel):
    id: UUID
    sort_order: int
    width: int
    height: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProjectResponse(BaseModel):
    id: UUID
    title: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProjectDetailResponse(ProjectResponse):
    images: list[ProjectImageResponse]
