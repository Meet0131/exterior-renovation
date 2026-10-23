import { apiBlob, apiJson, apiNoContent, uploadFile } from './client'
import type { UploadOptions } from './client'
import type {
  Calibration,
  DetectionResponse,
  FinalizeResponse,
  ImageUpdate,
  ImageUpload,
  UpdateImagePayload,
} from './types'

const JSON_HEADERS = {
  'Content-Type': 'application/json',
}

export function uploadProjectImage(
  projectId: string,
  file: File,
  options?: UploadOptions,
): Promise<ImageUpload> {
  return uploadFile<ImageUpload>(
    `/api/projects/${encodeURIComponent(projectId)}/images`,
    file,
    options,
  )
}

export function deleteProjectImage(
  imageId: string,
  signal?: AbortSignal,
): Promise<void> {
  return apiNoContent(`/api/images/${encodeURIComponent(imageId)}`, {
    method: 'DELETE',
    signal,
  })
}

export function sourceImageUrl(imageId: string): string {
  return `/api/images/${encodeURIComponent(imageId)}`
}

export function getSourceImage(
  imageId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  return apiBlob(`/api/images/${encodeURIComponent(imageId)}`, { signal })
}

export function getCalibration(
  imageId: string,
  signal?: AbortSignal,
): Promise<Calibration> {
  return apiJson<Calibration>(
    `/api/images/${encodeURIComponent(imageId)}/calibration`,
    { signal },
  )
}

export function updateImage(
  imageId: string,
  payload: UpdateImagePayload,
  signal?: AbortSignal,
): Promise<ImageUpdate> {
  return apiJson<ImageUpdate>(
    `/api/images/${encodeURIComponent(imageId)}`,
    {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
      signal,
    },
  )
}

export function detectRegions(
  imageId: string,
  refresh: boolean,
  signal?: AbortSignal,
): Promise<DetectionResponse> {
  const query = refresh ? '?refresh=true' : ''
  return apiJson<DetectionResponse>(
    `/api/images/${encodeURIComponent(imageId)}/detect-regions${query}`,
    { method: 'POST', signal },
  )
}

export function getFinalPreview(
  imageId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  return apiBlob(
    `/api/images/${encodeURIComponent(imageId)}/final-preview`,
    { signal },
  )
}

export function finalPreviewUrl(imageId: string): string {
  return `/api/images/${encodeURIComponent(imageId)}/final-preview`
}

export function finalizeImage(
  imageId: string,
  signal?: AbortSignal,
): Promise<FinalizeResponse> {
  return apiJson<FinalizeResponse>(
    `/api/images/${encodeURIComponent(imageId)}/finalize`,
    { method: 'POST', signal },
  )
}
