import { apiJson } from './client'
import type { ImageEstimate, ProjectEstimate } from './types'

export function getImageEstimate(
  imageId: string,
  signal?: AbortSignal,
): Promise<ImageEstimate> {
  return apiJson<ImageEstimate>(
    `/api/images/${encodeURIComponent(imageId)}/estimate`,
    { signal },
  )
}

export function getProjectEstimate(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectEstimate> {
  return apiJson<ProjectEstimate>(
    `/api/projects/${encodeURIComponent(projectId)}/estimate`,
    { signal },
  )
}
