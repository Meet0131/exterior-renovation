import { apiJson } from './client'
import type { MaterialCatalog } from './types'

export function getMaterials(signal?: AbortSignal): Promise<MaterialCatalog> {
  return apiJson<MaterialCatalog>('/api/materials', { signal })
}
