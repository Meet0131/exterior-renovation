import { apiJson } from './client'
import type {
  CreateProjectPayload,
  Project,
  ProjectDetail,
  ProjectSummary,
  UpdateProjectPayload,
} from './types'

const JSON_HEADERS = {
  'Content-Type': 'application/json',
}

export function createProject(
  payload: CreateProjectPayload,
  signal?: AbortSignal,
): Promise<Project> {
  return apiJson<Project>('/api/projects', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
    signal,
  })
}

export function listProjects(
  signal?: AbortSignal,
): Promise<ProjectSummary[]> {
  return apiJson<ProjectSummary[]>('/api/projects', { signal })
}

export function getProject(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectDetail> {
  return apiJson<ProjectDetail>(
    `/api/projects/${encodeURIComponent(projectId)}`,
    { signal },
  )
}

export function renameProject(
  projectId: string,
  payload: UpdateProjectPayload,
  signal?: AbortSignal,
): Promise<Project> {
  return apiJson<Project>(
    `/api/projects/${encodeURIComponent(projectId)}`,
    {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
      signal,
    },
  )
}
