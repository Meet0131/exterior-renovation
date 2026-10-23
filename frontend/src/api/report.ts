import { apiFile } from './client'
import type { DownloadedFile } from './types'

export function getProjectReport(
  projectId: string,
  signal?: AbortSignal,
): Promise<DownloadedFile> {
  return apiFile(
    `/api/projects/${encodeURIComponent(projectId)}/report.pdf`,
    { signal },
  )
}
