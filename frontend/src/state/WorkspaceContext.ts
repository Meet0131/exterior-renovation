import { createContext } from 'react'
import type { UploadOptions } from '../api/client'
import type {
  Calibration,
  CalibrationPayload,
  GeometryPoint,
  GeometryType,
  ImageUpload,
  Material,
  ProjectDetail,
  ProjectImage,
  Region,
  RegionPatchPayload,
  RegionRole,
  SurfaceType,
} from '../api/types'
import type { SaveState } from '../lib/saveQueue'
import type { Step } from '../lib/steps'

export type FinalPreviewStatus =
  | 'unknown'
  | 'checking'
  | 'fresh'
  | 'absent'
  | 'missing-image'
  | 'error'

export type LoadErrorKind =
  | 'invalid-link'
  | 'network'
  | 'not-found'
  | 'server'

export interface LoadError {
  kind: LoadErrorKind
  message: string
}

export type ToastTone = 'info' | 'success' | 'error'
export type BannerTone = 'info' | 'warning' | 'error'

export interface ToastMessage {
  id: number
  tone: ToastTone
  message: string
}

export interface BannerMessage {
  id: number
  tone: BannerTone
  title: string
  message: string
  actionLabel?: string
  action?: () => void
}

export type CopyLinkResult = 'copied' | 'blocked' | 'manual'

export interface SaveErrorInfo {
  resource: 'title' | 'regions' | 'calibration'
  message: string
  regionId?: string
  field?: string | null
}

export interface NewRegionInput {
  name: string
  geometry_type: GeometryType
  geometry_json: GeometryPoint[]
  surface_type: SurfaceType
  region_role: RegionRole
}

export interface WorkspaceContextValue {
  project: ProjectDetail | null
  activeImage: ProjectImage | null
  materials: Material[]
  materialsLoading: boolean
  calibration: Calibration | null
  regions: Region[]
  selectedRegionId: string | null
  step: Step
  loading: boolean
  loadError: LoadError | null
  saveState: SaveState
  saveError: string | null
  saveErrorInfo: SaveErrorInfo | null
  visualDirty: boolean
  finalizing: boolean
  finalPreviewStatus: FinalPreviewStatus
  finalPreviewBlob: Blob | null
  finalPreviewUrl: string | null
  projectTitleDraft: string
  toast: ToastMessage | null
  banner: BannerMessage | null
  setProjectTitleDraft: (value: string) => void
  commitProjectTitle: () => Promise<void>
  navigate: (step: Step) => Promise<void>
  selectImage: (imageId: string) => Promise<boolean>
  reorderImages: (movedImageId: string, targetImageId: string) => Promise<void>
  deleteImage: (imageId: string) => Promise<void>
  continueToEstimate: () => Promise<boolean>
  startProject: (title?: string) => Promise<void>
  uploadProjectPhoto: (
    file: File,
    options?: UploadOptions,
  ) => Promise<ImageUpload>
  startOver: () => void
  retryLoad: () => Promise<void>
  reloadMaterials: () => Promise<void>
  refreshRegions: () => Promise<void>
  refreshFinalPreview: () => Promise<FinalPreviewStatus>
  selectRegion: (regionId: string | null) => void
  updateRegion: (
    regionId: string,
    patch: RegionPatchPayload,
  ) => void
  updateRegions: (
    updates: Array<{ regionId: string; patch: RegionPatchPayload }>,
  ) => void
  createRegion: (input: NewRegionInput) => string
  deleteRegion: (regionId: string) => void
  updateCalibration: (payload: CalibrationPayload | null) => void
  copyProjectLink: () => Promise<CopyLinkResult>
  showToast: (message: string, tone?: ToastTone) => void
  showBanner: (banner: Omit<BannerMessage, 'id'>) => number
  dismissBanner: () => void
  retrySave: () => Promise<void>
  flushSaves: () => Promise<boolean>
  markVisualDirty: () => void
  setFinalPreviewBlob: (blob: Blob) => void
  clearFinalPreview: () => void
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)
