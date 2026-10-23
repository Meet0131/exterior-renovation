import { apiJson } from './client'
import type {
  Region,
  RegionList,
  RegionPatchPayload,
  RegionWritePayload,
} from './types'

const JSON_HEADERS = {
  'Content-Type': 'application/json',
}

export function getRegions(
  imageId: string,
  signal?: AbortSignal,
): Promise<RegionList> {
  return apiJson<RegionList>(
    `/api/images/${encodeURIComponent(imageId)}/regions`,
    { signal },
  )
}

export function replaceRegions(
  imageId: string,
  regions: RegionWritePayload[],
  signal?: AbortSignal,
): Promise<RegionList> {
  return apiJson<RegionList>(
    `/api/images/${encodeURIComponent(imageId)}/regions`,
    {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ regions }),
      signal,
    },
  )
}

export function updateRegion(
  imageId: string,
  regionId: string,
  payload: RegionPatchPayload,
  signal?: AbortSignal,
): Promise<Region> {
  return apiJson<Region>(
    `/api/images/${encodeURIComponent(imageId)}/regions/${encodeURIComponent(regionId)}`,
    {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
      signal,
    },
  )
}
