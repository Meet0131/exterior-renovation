import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import {
  ApiError,
  getErrorMessage,
  isAbortError,
} from '../api/client'
import type { UploadOptions } from '../api/client'
import {
  deleteProjectImage,
  getCalibration,
  getFinalPreview,
  finalizeImage,
  updateImage,
  uploadProjectImage,
} from '../api/images'
import { getMaterials } from '../api/materials'
import { createProject, getProject, renameProject } from '../api/projects'
import {
  getRegions,
  replaceRegions,
  updateRegion as patchRegion,
} from '../api/regions'
import type {
  Calibration,
  CalibrationPayload,
  ImageUpload,
  Material,
  ProjectDetail,
  ProjectImage,
  Region,
  RegionPatchPayload,
  RegionWritePayload,
} from '../api/types'
import { sortProjectImages } from '../lib/photos'
import { SaveQueue } from '../lib/saveQueue'
import type { SaveState } from '../lib/saveQueue'
import { stepIndex } from '../lib/steps'
import type { Step } from '../lib/steps'
import {
  clearProjectUrl,
  isValidUuid,
  pushStepUrl,
  readUrlState,
  replaceImageUrl,
  replaceProjectUrl,
  replaceStepUrl,
} from '../lib/url'
import { WorkspaceContext } from './WorkspaceContext'
import type {
  BannerMessage,
  CopyLinkResult,
  FinalPreviewStatus,
  LoadErrorKind,
  NewRegionInput,
  SaveErrorInfo,
  ToastTone,
} from './WorkspaceContext'

interface WorkspaceState {
  project: ProjectDetail | null
  activeImage: ProjectImage | null
  materials: Material[]
  materialsLoading: boolean
  calibration: Calibration | null
  regions: Region[]
  selectedRegionId: string | null
  step: Step
  loading: boolean
  loadError: { kind: LoadErrorKind; message: string } | null
  saveState: SaveState
  saveError: string | null
  saveErrorInfo: SaveErrorInfo | null
  visualDirty: boolean
  finalizing: boolean
  finalPreviewStatus: FinalPreviewStatus
  finalPreviewBlob: Blob | null
  finalPreviewUrl: string | null
  projectTitleDraft: string
  toast: { id: number; tone: ToastTone; message: string } | null
  banner: BannerMessage | null
}

const EMPTY_STATE: WorkspaceState = {
  project: null,
  activeImage: null,
  materials: [],
  materialsLoading: false,
  calibration: null,
  regions: [],
  selectedRegionId: null,
  step: 'upload',
  loading: false,
  loadError: null,
  saveState: 'idle',
  saveError: null,
  saveErrorInfo: null,
  visualDirty: false,
  finalizing: false,
  finalPreviewStatus: 'unknown',
  finalPreviewBlob: null,
  finalPreviewUrl: null,
  projectTitleDraft: '',
  toast: null,
  banner: null,
}

interface StepSnapshot {
  activeImage: ProjectImage | null
  regions: Region[]
  calibration: Calibration | null
  finalPreviewStatus: FinalPreviewStatus
  visualDirty: boolean
}

function finishRegions(regions: Region[]): Region[] {
  return regions.filter((region) => region.region_role === 'finish')
}

function getStepBlocker(target: Step, snapshot: StepSnapshot): string | null {
  if (target === 'upload') return null
  if (snapshot.activeImage === null) {
    return 'Add a photo before moving on.'
  }
  if (target === 'regions') return null
  if (snapshot.regions.length === 0) {
    return 'Mark at least one region before moving on.'
  }
  if (snapshot.calibration === null) {
    return 'Set the calibration before moving on.'
  }
  if (target === 'materials') return null

  const finishes = finishRegions(snapshot.regions)
  if (finishes.length === 0) {
    return 'Mark at least one surface to cost.'
  }
  if (finishes.some((region) => region.material_id === null)) {
    return 'Choose a material for every surface before moving on.'
  }
  return null
}

function resolveStep(
  requested: Step | null,
  snapshot: StepSnapshot,
): Step {
  if (requested !== null && getStepBlocker(requested, snapshot) === null) {
    return requested
  }
  if (snapshot.activeImage === null) return 'upload'
  if (snapshot.regions.length === 0) return 'regions'
  if (snapshot.calibration === null) return 'regions'

  const finishes = finishRegions(snapshot.regions)
  if (
    finishes.length === 0 ||
    finishes.some((region) => region.material_id === null)
  ) {
    return 'materials'
  }
  return 'estimate'
}

function chooseActiveImage(
  project: ProjectDetail,
  imageId: string | null,
): ProjectImage | null {
  const requested = imageId
    ? project.images.find((image) => image.id === imageId)
    : undefined
  if (requested) return requested

  return (
    [...project.images].sort(
      (first, second) => first.sort_order - second.sort_order,
    )[0] ?? null
  )
}

type SaveResource = 'title' | 'regions' | 'calibration'

const IDLE_SAVE_STATES: Record<SaveResource, SaveState> = {
  title: 'idle',
  regions: 'idle',
  calibration: 'idle',
}

function isVisualRegionPatch(patch: RegionPatchPayload): boolean {
  return (
    patch.geometry_type !== undefined ||
    patch.geometry_json !== undefined ||
    patch.surface_type !== undefined ||
    patch.region_role !== undefined ||
    patch.material_id !== undefined ||
    patch.color_hex !== undefined ||
    patch.sort_order !== undefined
  )
}

const LOCAL_REGION_PREFIX = 'local-'

function isLocalRegionId(regionId: string): boolean {
  return regionId.startsWith(LOCAL_REGION_PREFIX)
}

function normalizeRegion(region: Region): Region {
  const materialId = region.material_id === 'null' ? null : region.material_id
  const colorHex = region.color_hex === 'null' ? null : region.color_hex

  if (region.region_role !== 'finish') {
    return {
      ...region,
      material_id: null,
      color_hex: null,
      material_rate_override: null,
      labor_rate_override: null,
    }
  }

  return {
    ...region,
    material_id: materialId,
    color_hex: colorHex,
  }
}

function toRegionWritePayload(region: Region): RegionWritePayload {
  const normalized = normalizeRegion(region)
  return {
    id: isLocalRegionId(normalized.id) ? null : normalized.id,
    name: normalized.name,
    sort_order: normalized.sort_order,
    geometry_type: normalized.geometry_type,
    geometry_json: normalized.geometry_json,
    surface_type: normalized.surface_type,
    region_role: normalized.region_role,
    manual_area_sqft: normalized.manual_area_sqft,
    manual_length_ft: normalized.manual_length_ft,
    deduction_sqft: normalized.deduction_sqft,
    material_id: normalized.material_id,
    color_hex: normalized.color_hex,
    material_rate_override: normalized.material_rate_override,
    labor_rate_override: normalized.labor_rate_override,
  }
}

function calibrationsMatch(
  first: CalibrationPayload | null,
  second: CalibrationPayload | null,
): boolean {
  if (first === null || second === null) return first === second
  return (
    Math.abs(first.length_ft - second.length_ft) < 1e-6 &&
    Math.abs(first.p1_x - second.p1_x) < 1e-6 &&
    Math.abs(first.p1_y - second.p1_y) < 1e-6 &&
    Math.abs(first.p2_x - second.p2_x) < 1e-6 &&
    Math.abs(first.p2_y - second.p2_y) < 1e-6
  )
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkspaceState>(() => {
    const url = readUrlState()
    return {
      ...EMPTY_STATE,
      step: url.step ?? 'upload',
      loading: url.projectId !== null,
    }
  })
  const stateRef = useRef(state)
  useLayoutEffect(() => {
    stateRef.current = state
  }, [state])

  const titleTimerRef = useRef<number | null>(null)
  const titleDraftRef = useRef('')
  const titleVersionRef = useRef(0)
  const titleSaveActiveRef = useRef(false)
  const finalPreviewUrlRef = useRef<string | null>(null)
  const imageSwitchVersionRef = useRef(0)
  const loadAbortRef = useRef<AbortController | null>(null)
  const invalidLinkRef = useRef(false)
  const navigationRef = useRef(false)
  const continueToEstimateRef = useRef<() => Promise<boolean>>(async () => false)
  const ensureFinalPreviewRef = useRef<
    () => Promise<FinalPreviewStatus>
  >(async () => 'unknown')
  const ensureFinalPreviewPromiseRef = useRef<{
    imageId: string
    promise: Promise<FinalPreviewStatus>
  } | null>(null)
  const finalizeRunRef = useRef(0)
  const toastTimerRef = useRef<number | null>(null)
  const toastIdRef = useRef(0)
  const bannerIdRef = useRef(0)

  const regionsRef = useRef<Region[]>(state.regions)
  const calibrationRef = useRef<Calibration | null>(state.calibration)
  const selectedRegionIdRef = useRef<string | null>(
    state.selectedRegionId,
  )
  const saveStatesRef = useRef<Record<SaveResource, SaveState>>({
    ...IDLE_SAVE_STATES,
  })
  const saveErrorsRef = useRef<Record<SaveResource, string | null>>({
    title: null,
    regions: null,
    calibration: null,
  })
  const saveErrorInfoRef = useRef<SaveErrorInfo | null>(null)
  const regionSaveTimerRef = useRef<number | null>(null)
  const calibrationSaveTimerRef = useRef<number | null>(null)
  const regionSaveBannerIdRef = useRef<number | null>(null)
  const calibrationSaveBannerIdRef = useRef<number | null>(null)
  const pendingRegionPatchesRef = useRef<
    Map<string, { patch: RegionPatchPayload; version: number }>
  >(new Map())
  const pendingRegionSetRef = useRef(false)
  const regionSetSavingRef = useRef(false)
  const localRegionCounterRef = useRef(0)
  const regionVersionsRef = useRef<Map<string, number>>(new Map())
  const regionSetVersionRef = useRef(0)
  const pendingCalibrationRef = useRef<{
    payload: CalibrationPayload | null
    version: number
  } | null>(null)
  const calibrationVersionRef = useRef(0)
  const lastSavedCalibrationRef = useRef<CalibrationPayload | null>(
    state.calibration,
  )
  const regionsRequestRef = useRef(0)

  const hasPendingSaveWork = useCallback(
    () =>
      titleTimerRef.current !== null ||
      regionSaveTimerRef.current !== null ||
      calibrationSaveTimerRef.current !== null ||
      pendingRegionPatchesRef.current.size > 0 ||
      pendingRegionSetRef.current ||
      pendingCalibrationRef.current !== null,
    [],
  )

  const publishSaveState = useCallback(() => {
    const resourceStates = Object.values(saveStatesRef.current)
    const message =
      saveErrorsRef.current.title ??
      saveErrorsRef.current.regions ??
      saveErrorsRef.current.calibration ??
      null
    const saveState: SaveState = resourceStates.includes('error')
      ? 'error'
      : resourceStates.includes('saving') || hasPendingSaveWork()
        ? 'saving'
        : resourceStates.includes('saved')
          ? 'saved'
          : 'idle'

    setState((previous) => ({
      ...previous,
      saveState,
      saveError: message,
      saveErrorInfo: saveErrorInfoRef.current,
    }))
  }, [hasPendingSaveWork])

  const recordSaveState = useCallback(
    (
      resource: SaveResource,
      nextState: SaveState,
      error: string | null,
    ) => {
      saveStatesRef.current[resource] = nextState

      if (nextState === 'error') {
        saveErrorsRef.current[resource] = error
        if (resource === 'title' || saveErrorInfoRef.current === null) {
          saveErrorInfoRef.current = {
            resource,
            message: error ?? 'Something went wrong.',
          }
        }
      } else {
        saveErrorsRef.current[resource] = null
        if (saveErrorInfoRef.current?.resource === resource) {
          saveErrorInfoRef.current = null
        }
      }

      if (
        resource === 'title' &&
        (nextState === 'saved' ||
          nextState === 'idle' ||
          nextState === 'error')
      ) {
        titleSaveActiveRef.current = false
      }

      publishSaveState()
    },
    [publishSaveState],
  )

  const handleTitleSaveState = useCallback(
    (nextState: SaveState, error: string | null) => {
      recordSaveState('title', nextState, error)
    },
    [recordSaveState],
  )

  const handleRegionSaveState = useCallback(
    (nextState: SaveState, error: string | null) => {
      recordSaveState('regions', nextState, error)
    },
    [recordSaveState],
  )

  const handleCalibrationSaveState = useCallback(
    (nextState: SaveState, error: string | null) => {
      recordSaveState('calibration', nextState, error)
    },
    [recordSaveState],
  )

  const [titleQueue] = useState(
    // The queue is created once; its listener reads refs only when a save runs.
    // oxlint-disable-next-line react/refs
    () => new SaveQueue(handleTitleSaveState),
  )
  const [regionQueue] = useState(
    // oxlint-disable-next-line react/refs
    () => new SaveQueue(handleRegionSaveState),
  )
  const [calibrationQueue] = useState(
    // oxlint-disable-next-line react/refs
    () => new SaveQueue(handleCalibrationSaveState),
  )

  const resetSaveTracking = useCallback((next: SaveState) => {
    saveStatesRef.current = {
      title: next,
      regions: next,
      calibration: next,
    }
    saveErrorsRef.current = {
      title: null,
      regions: null,
      calibration: null,
    }
    saveErrorInfoRef.current = null
    titleSaveActiveRef.current = false
  }, [])

  const clearTitleTimer = useCallback(() => {
    if (titleTimerRef.current !== null) {
      window.clearTimeout(titleTimerRef.current)
      titleTimerRef.current = null
    }
  }, [])

  const revokeFinalPreviewUrl = useCallback(() => {
    if (finalPreviewUrlRef.current !== null) {
      URL.revokeObjectURL(finalPreviewUrlRef.current)
      finalPreviewUrlRef.current = null
    }
  }, [])

  const markVisualDirty = useCallback(() => {
    revokeFinalPreviewUrl()
    setState((previous) => ({
      ...previous,
      visualDirty: true,
      finalPreviewStatus:
        previous.activeImage === null ? 'unknown' : 'absent',
      finalPreviewBlob: null,
      finalPreviewUrl: null,
    }))
  }, [revokeFinalPreviewUrl])

  const replaceRegionsState = useCallback(
    (nextRegions: Region[], preferredId?: string | null) => {
      const normalized = nextRegions.map(normalizeRegion)
      regionsRef.current = normalized
      const currentSelected =
        preferredId === undefined
          ? selectedRegionIdRef.current
          : preferredId
      const nextSelected =
        currentSelected !== null &&
        normalized.some((region) => region.id === currentSelected)
          ? currentSelected
          : preferredId === undefined
            ? (normalized[0]?.id ?? null)
            : null
      selectedRegionIdRef.current = nextSelected
      setState((previous) => ({
        ...previous,
        regions: normalized,
        selectedRegionId: nextSelected,
      }))
    },
    [],
  )

  const applyRegionPatchState = useCallback(
    (regionId: string, patch: RegionPatchPayload) => {
      const nextRegions = regionsRef.current.map((region) =>
        region.id === regionId ? { ...region, ...patch } : region,
      )
      regionsRef.current = nextRegions
      setState((previous) => ({
        ...previous,
        regions: nextRegions,
      }))
    },
    [],
  )

  const setCalibrationState = useCallback(
    (nextCalibration: Calibration | null) => {
      calibrationRef.current = nextCalibration
      setState((previous) => ({
        ...previous,
        calibration: nextCalibration,
      }))
    },
    [],
  )

  const selectRegion = useCallback((regionId: string | null) => {
    selectedRegionIdRef.current = regionId
    setState((previous) => ({
      ...previous,
      selectedRegionId: regionId,
    }))
  }, [])

  const showToast = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current)
      }
      const id = ++toastIdRef.current
      setState((previous) => ({
        ...previous,
        toast: { id, tone, message },
      }))
      toastTimerRef.current = window.setTimeout(() => {
        setState((previous) => ({ ...previous, toast: null }))
        toastTimerRef.current = null
      }, 3600)
    },
    [],
  )

  const showBanner = useCallback(
    (banner: Omit<BannerMessage, 'id'>) => {
      const id = ++bannerIdRef.current
      setState((previous) => ({
        ...previous,
        banner: { ...banner, id },
      }))
      return id
    },
    [],
  )

  const dismissBanner = useCallback(() => {
    setState((previous) => ({ ...previous, banner: null }))
  }, [])

  const clearRegionSaveBanner = useCallback(() => {
    const bannerId = regionSaveBannerIdRef.current
    regionSaveBannerIdRef.current = null
    if (
      bannerId !== null &&
      stateRef.current.banner?.id === bannerId
    ) {
      dismissBanner()
    }
  }, [dismissBanner])

  const clearCalibrationSaveBanner = useCallback(() => {
    const bannerId = calibrationSaveBannerIdRef.current
    calibrationSaveBannerIdRef.current = null
    if (
      bannerId !== null &&
      stateRef.current.banner?.id === bannerId
    ) {
      dismissBanner()
    }
  }, [dismissBanner])

  const reloadMaterialsRef = useRef<() => Promise<void>>(async () => {})
  const reloadMaterials = useCallback(async () => {
    setState((previous) => ({ ...previous, materialsLoading: true }))
    try {
      const catalog = await getMaterials()
      setState((previous) => ({
        ...previous,
        materials: catalog.materials,
        materialsLoading: false,
      }))
    } catch (error) {
      if (isAbortError(error)) return
      setState((previous) => ({ ...previous, materialsLoading: false }))
      showBanner({
        tone: 'error',
        title: 'Materials did not load',
        message: getErrorMessage(error),
        actionLabel: 'Retry',
        action: () => {
          void reloadMaterialsRef.current()
        },
      })
    }
  }, [showBanner])
  useEffect(() => {
    reloadMaterialsRef.current = reloadMaterials
  }, [reloadMaterials])

  const refreshRegionsRef = useRef<() => Promise<void>>(async () => {})
  const refreshRegions = useCallback(async () => {
    const image = stateRef.current.activeImage
    if (image === null) return

    const requestVersion = ++regionsRequestRef.current

    try {
      const response = await getRegions(image.id)
      if (
        stateRef.current.activeImage?.id !== image.id ||
        regionsRequestRef.current !== requestVersion
      ) {
        return
      }
      replaceRegionsState(response.regions)
      showToast('Regions reloaded.', 'success')
    } catch (error) {
      if (
        isAbortError(error) ||
        stateRef.current.activeImage?.id !== image.id ||
        regionsRequestRef.current !== requestVersion
      ) {
        return
      }
      showBanner({
        tone: 'error',
        title: 'Regions did not load',
        message: getErrorMessage(error),
        actionLabel: 'Retry',
        action: () => {
          void refreshRegionsRef.current()
        },
      })
    }
  }, [replaceRegionsState, showBanner, showToast])
  useEffect(() => {
    refreshRegionsRef.current = refreshRegions
  }, [refreshRegions])

  const refreshFinalPreviewRef = useRef<() => Promise<FinalPreviewStatus>>(
    async () => 'unknown',
  )
  const refreshFinalPreview = useCallback(async (): Promise<FinalPreviewStatus> => {
    const image = stateRef.current.activeImage
    if (image === null) return 'unknown'

    revokeFinalPreviewUrl()
    setState((previous) => ({
      ...previous,
      finalPreviewStatus: 'checking',
      finalPreviewBlob: null,
      finalPreviewUrl: null,
    }))

    try {
      const blob = await getFinalPreview(image.id)
      if (stateRef.current.activeImage?.id !== image.id) return 'unknown'
      const url = URL.createObjectURL(blob)
      finalPreviewUrlRef.current = url
      setState((previous) => ({
        ...previous,
        finalPreviewStatus: 'fresh',
        finalPreviewBlob: blob,
        finalPreviewUrl: url,
      }))
      return 'fresh'
    } catch (error) {
      if (
        isAbortError(error) ||
        stateRef.current.activeImage?.id !== image.id
      ) {
        return stateRef.current.finalPreviewStatus
      }

      if (
        error instanceof ApiError &&
        error.code === 'FINAL_PREVIEW_NOT_FOUND'
      ) {
        setState((previous) => ({
          ...previous,
          finalPreviewStatus: 'absent',
        }))
        return 'absent'
      }

      if (error instanceof ApiError && error.code === 'IMAGE_NOT_FOUND') {
        setState((previous) => ({
          ...previous,
          finalPreviewStatus: 'missing-image',
        }))
        return 'missing-image'
      }

      setState((previous) => ({
        ...previous,
        finalPreviewStatus: 'error',
      }))
      showBanner({
        tone: 'warning',
        title: 'Could not check the final image',
        message: getErrorMessage(error),
        actionLabel: 'Retry',
        action: () => {
          void refreshFinalPreviewRef.current()
        },
      })
      return 'error'
    }
  }, [revokeFinalPreviewUrl, showBanner])
  useEffect(() => {
    refreshFinalPreviewRef.current = refreshFinalPreview
  }, [refreshFinalPreview])

  const clearRegionSaveTimers = useCallback(() => {
    if (regionSaveTimerRef.current !== null) {
      window.clearTimeout(regionSaveTimerRef.current)
      regionSaveTimerRef.current = null
    }
    if (calibrationSaveTimerRef.current !== null) {
      window.clearTimeout(calibrationSaveTimerRef.current)
      calibrationSaveTimerRef.current = null
    }
  }, [])

  const resetRegionSaving = useCallback(() => {
    clearRegionSaveTimers()
    pendingRegionPatchesRef.current.clear()
    pendingRegionSetRef.current = false
    regionSetSavingRef.current = false
    pendingCalibrationRef.current = null
    regionVersionsRef.current.clear()
    regionSetVersionRef.current = 0
    calibrationVersionRef.current = 0
    regionQueue.reset()
    calibrationQueue.reset()
  }, [calibrationQueue, clearRegionSaveTimers, regionQueue])

  const resetRegionData = useCallback(() => {
    regionsRequestRef.current += 1
    regionsRef.current = []
    calibrationRef.current = null
    selectedRegionIdRef.current = null
    lastSavedCalibrationRef.current = null
    resetRegionSaving()
  }, [resetRegionSaving])

  const resetWorkspaceData = useCallback(() => {
    resetRegionData()
    titleQueue.reset()
    resetSaveTracking('idle')
  }, [resetRegionData, resetSaveTracking, titleQueue])

  const restoreWorkspace = useCallback(async (force = false) => {
    const url = readUrlState()
    const current = stateRef.current

    if (url.projectId === null) {
      if (invalidLinkRef.current) return

      const currentProject = stateRef.current.project
      if (
        currentProject === null &&
        !stateRef.current.loading &&
        stateRef.current.loadError === null
      ) {
        return
      }

      loadAbortRef.current?.abort()
      loadAbortRef.current = null
      clearTitleTimer()
      revokeFinalPreviewUrl()
      resetWorkspaceData()
      titleDraftRef.current = ''
      titleVersionRef.current += 1
      setState({ ...EMPTY_STATE, loading: false })
      return
    }

    if (!isValidUuid(url.projectId)) {
      loadAbortRef.current?.abort()
      loadAbortRef.current = null
      clearTitleTimer()
      revokeFinalPreviewUrl()
      invalidLinkRef.current = true
      clearProjectUrl()
      resetWorkspaceData()
      titleDraftRef.current = ''
      titleVersionRef.current += 1
      setState({
        ...EMPTY_STATE,
        loading: false,
        loadError: {
          kind: 'invalid-link',
          message: 'Check the address, or start a new project.',
        },
      })
      return
    }

    invalidLinkRef.current = false

    if (
      !force &&
      current.project?.id === url.projectId &&
      !current.loading &&
      (url.imageId === null || current.activeImage?.id === url.imageId)
    ) {
      const resolved = resolveStep(url.step, {
        activeImage: current.activeImage,
        regions: current.regions,
        calibration: current.calibration,
        finalPreviewStatus: current.finalPreviewStatus,
        visualDirty: current.visualDirty,
      })
      if (resolved !== url.step) replaceStepUrl(resolved)
      if (resolved !== current.step) {
        setState((previous) => ({ ...previous, step: resolved }))
      }
      return
    }

    loadAbortRef.current?.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller
    const { signal } = controller

    clearTitleTimer()
    revokeFinalPreviewUrl()
    resetWorkspaceData()
    titleDraftRef.current = ''
    titleVersionRef.current += 1

    setState((previous) => ({
      ...previous,
      loading: true,
      loadError: null,
      project: null,
      activeImage: null,
      materialsLoading: true,
      calibration: null,
      regions: [],
      selectedRegionId: null,
      finalPreviewStatus: 'unknown',
      finalPreviewBlob: null,
      finalPreviewUrl: null,
      projectTitleDraft: '',
      saveState: 'idle',
      saveError: null,
      saveErrorInfo: null,
      visualDirty: false,
      toast: null,
      banner: null,
    }))

    try {
      const [projectResult, materialsResult] = await Promise.allSettled([
        getProject(url.projectId, signal),
        getMaterials(signal),
      ])

      if (signal.aborted) return

      if (projectResult.status === 'rejected') {
        if (isAbortError(projectResult.reason)) return
        const reason = projectResult.reason
        const invalid =
          reason instanceof ApiError &&
          (reason.status === 404 || reason.status === 422)
        const kind: LoadErrorKind = invalid
          ? 'invalid-link'
          : reason instanceof ApiError && reason.status === 0
            ? 'network'
            : 'server'

        if (invalid) clearProjectUrl()

        setState((previous) => ({
          ...previous,
          loading: false,
          materialsLoading: false,
          loadError: {
            kind,
            message: invalid
              ? 'Check the address, or start a new project.'
              : getErrorMessage(reason),
          },
        }))
        return
      }

      const project = projectResult.value
      const materials =
        materialsResult.status === 'fulfilled'
          ? materialsResult.value.materials
          : []
      const materialsError =
        materialsResult.status === 'rejected' &&
        !isAbortError(materialsResult.reason)
          ? getErrorMessage(materialsResult.reason)
          : null
      const activeImage = chooseActiveImage(project, url.imageId)

      let calibration: Calibration | null = null
      let regions: Region[] = []
      let finalPreviewStatus: FinalPreviewStatus = 'absent'
      let finalPreviewBlob: Blob | null = null
      let finalPreviewUrl: string | null = null
      let banner: BannerMessage | null = null

      if (activeImage !== null) {
        const [calibrationResult, regionsResult, previewResult] =
          await Promise.allSettled([
            getCalibration(activeImage.id, signal),
            getRegions(activeImage.id, signal),
            getFinalPreview(activeImage.id, signal),
          ])

        if (signal.aborted) return

        if (calibrationResult.status === 'fulfilled') {
          calibration = calibrationResult.value
        } else if (!isAbortError(calibrationResult.reason)) {
          const reason = calibrationResult.reason
          if (
            reason instanceof ApiError &&
            reason.code === 'CALIBRATION_NOT_FOUND'
          ) {
            calibration = null
          } else if (
            reason instanceof ApiError &&
            reason.code === 'IMAGE_NOT_FOUND'
          ) {
            banner = {
              id: ++bannerIdRef.current,
              tone: 'warning',
              title: 'This photo is unavailable',
              message:
                'The photo is no longer stored with this project. Start a new project to continue.',
              actionLabel: 'Reload',
              action: () => window.location.reload(),
            }
          } else {
            banner = {
              id: ++bannerIdRef.current,
              tone: 'warning',
              title: 'The scale did not load',
              message: getErrorMessage(reason),
              actionLabel: 'Retry',
              action: () => window.location.reload(),
            }
          }
        }

        if (regionsResult.status === 'fulfilled') {
          regions = regionsResult.value.regions.map(normalizeRegion)
        } else if (!isAbortError(regionsResult.reason)) {
          banner = banner ?? {
            id: ++bannerIdRef.current,
            tone: 'error',
            title: 'Regions did not load',
            message: getErrorMessage(regionsResult.reason),
            actionLabel: 'Retry',
            action: () => {
              void refreshRegionsRef.current()
            },
          }
        }

        if (previewResult.status === 'fulfilled') {
          finalPreviewBlob = previewResult.value
          finalPreviewUrl = URL.createObjectURL(previewResult.value)
          finalPreviewStatus = 'fresh'
        } else if (!isAbortError(previewResult.reason)) {
          const reason = previewResult.reason
          if (
            reason instanceof ApiError &&
            reason.code === 'FINAL_PREVIEW_NOT_FOUND'
          ) {
            finalPreviewStatus = 'absent'
          } else if (
            reason instanceof ApiError &&
            reason.code === 'IMAGE_NOT_FOUND'
          ) {
            finalPreviewStatus = 'missing-image'
          } else {
            finalPreviewStatus = 'error'
            banner = banner ?? {
              id: ++bannerIdRef.current,
              tone: 'warning',
              title: 'Could not check the final image',
              message: getErrorMessage(reason),
              actionLabel: 'Retry',
              action: () => {
                void refreshFinalPreviewRef.current()
              },
            }
          }
        }
      }

      if (signal.aborted) {
        if (finalPreviewUrl !== null) URL.revokeObjectURL(finalPreviewUrl)
        return
      }

      const resolved = resolveStep(url.step, {
        activeImage,
        regions,
        calibration,
        finalPreviewStatus,
        visualDirty: false,
      })

      if (resolved !== url.step) replaceStepUrl(resolved)

      if (finalPreviewUrl !== null) {
        finalPreviewUrlRef.current = finalPreviewUrl
      }

      if (banner === null && materialsError !== null) {
        banner = {
          id: ++bannerIdRef.current,
          tone: 'warning',
          title: 'Materials did not load',
          message: materialsError,
          actionLabel: 'Retry',
          action: () => {
            void reloadMaterialsRef.current()
          },
        }
      }

      titleDraftRef.current = project.title
      titleVersionRef.current += 1
      titleSaveActiveRef.current = false

      regionsRef.current = regions
      calibrationRef.current = calibration
      lastSavedCalibrationRef.current = calibration
      const selectedRegionId = regions[0]?.id ?? null
      selectedRegionIdRef.current = selectedRegionId
      resetSaveTracking('saved')

      setState((previous) => ({
        ...previous,
        project,
        activeImage,
        materials,
        materialsLoading: false,
        calibration,
        regions,
        selectedRegionId,
        finalPreviewStatus,
        finalPreviewBlob,
        finalPreviewUrl,
        projectTitleDraft: project.title,
        step: resolved,
        loading: false,
        loadError: null,
        saveState: 'saved',
        saveError: null,
        saveErrorInfo: null,
        visualDirty: false,
        finalizing: false,
        banner,
      }))
    } catch (error) {
      if (signal.aborted || isAbortError(error)) return
      setState((previous) => ({
        ...previous,
        loading: false,
        materialsLoading: false,
        loadError: {
          kind:
            error instanceof ApiError && error.status === 0
              ? 'network'
              : 'server',
          message: getErrorMessage(error),
        },
      }))
    } finally {
      if (loadAbortRef.current === controller) {
        loadAbortRef.current = null
      }
    }
  }, [
    clearTitleTimer,
    resetSaveTracking,
    resetWorkspaceData,
    revokeFinalPreviewUrl,
  ])

  const recoverImageSaveFailure = useCallback(
    (error: unknown): boolean => {
      if (!(error instanceof ApiError)) return false
      if (
        error.code === 'IMAGE_NOT_FOUND' ||
        error.code === 'PROJECT_NOT_FOUND'
      ) {
        void restoreWorkspace(true)
        return true
      }
      return false
    },
    [restoreWorkspace],
  )

  const recoverRegionSaveFailure = useCallback(
    (error: unknown): boolean => {
      if (recoverImageSaveFailure(error)) return true
      if (!(error instanceof ApiError)) return false

      const staleRegion =
        error.code === 'REGION_NOT_FOUND' ||
        error.code === 'REGION_ID_CONFLICT' ||
        (error.code === 'VALIDATION_ERROR' &&
          typeof error.field === 'string' &&
          (error.field === 'id' || error.field.endsWith('.id')))

      if (!staleRegion) return false

      clearRegionSaveTimers()
      pendingRegionPatchesRef.current.clear()
      pendingRegionSetRef.current = false
      regionSaveBannerIdRef.current = null
      showBanner({
        tone: 'warning',
        title: 'The region set changed',
        message:
          'Another tab may have changed this photo. Reloading the saved regions.',
      })
      void refreshRegionsRef.current()
      return true
    },
    [clearRegionSaveTimers, recoverImageSaveFailure, showBanner],
  )

  const showRegionSaveError = useCallback(
    (regionId: string | undefined, error: unknown) => {
      const message = getErrorMessage(error)
      saveErrorInfoRef.current = {
        resource: 'regions',
        regionId,
        field: error instanceof ApiError ? error.field : null,
        message,
      }
      publishSaveState()

      const inlineValidation =
        error instanceof ApiError &&
        error.status === 422 &&
        regionId !== undefined

      if (!inlineValidation) {
        regionSaveBannerIdRef.current = showBanner({
          tone: 'error',
          title: 'Couldn’t save this region',
          message,
          actionLabel: 'Retry',
          action: () => {
            void regionQueue.retry()
          },
        })
      }
    },
    [publishSaveState, regionQueue, showBanner],
  )

  const showCalibrationSaveError = useCallback(
    (error: unknown) => {
      const message = getErrorMessage(error)
      saveErrorInfoRef.current = {
        resource: 'calibration',
        field: error instanceof ApiError ? error.field : null,
        message,
      }
      publishSaveState()

      if (!(error instanceof ApiError) || error.status !== 422) {
        calibrationSaveBannerIdRef.current = showBanner({
          tone: 'error',
          title: 'Couldn’t save the scale',
          message,
          actionLabel: 'Retry',
          action: () => {
            void calibrationQueue.retry()
          },
        })
      }
    },
    [calibrationQueue, publishSaveState, showBanner],
  )

  const enqueueRegionSetSave = useCallback(() => {
    if (!pendingRegionSetRef.current) return

    regionQueue.schedule(async () => {
      const image = stateRef.current.activeImage
      if (image === null) return

      pendingRegionSetRef.current = false
      regionSetSavingRef.current = true
      const payloads = regionsRef.current.map(toRegionWritePayload)
      const setVersion = regionSetVersionRef.current

      try {
        const saved = await replaceRegions(image.id, payloads)
        if (stateRef.current.activeImage?.id !== image.id) return

        if (regionSetVersionRef.current === setVersion) {
          const currentSelected = selectedRegionIdRef.current
          const selectedRegion = regionsRef.current.find(
            (region) => region.id === currentSelected,
          )
          const preferredId =
            currentSelected !== null &&
            !saved.regions.some(
              (region) => region.id === currentSelected,
            )
              ? (saved.regions.find(
                  (region) =>
                    region.sort_order === selectedRegion?.sort_order,
                )?.id ?? null)
              : currentSelected

          pendingRegionPatchesRef.current.clear()
          replaceRegionsState(saved.regions, preferredId)
        }
        clearRegionSaveBanner()
      } catch (error) {
        if (stateRef.current.activeImage?.id !== image.id) return
        if (recoverRegionSaveFailure(error)) return

        pendingRegionSetRef.current = true
        showRegionSaveError(undefined, error)
        throw error
      } finally {
        regionSetSavingRef.current = false
      }
    })
  }, [
    clearRegionSaveBanner,
    recoverRegionSaveFailure,
    regionQueue,
    replaceRegionsState,
    showRegionSaveError,
  ])

  const enqueueRegionPatchSave = useCallback(() => {
    if (pendingRegionPatchesRef.current.size === 0) return
    if (pendingRegionSetRef.current) {
      enqueueRegionSetSave()
      return
    }

    regionQueue.schedule(async () => {
      const image = stateRef.current.activeImage
      if (image === null) return

      const entries = Array.from(
        pendingRegionPatchesRef.current.entries(),
      )
      pendingRegionPatchesRef.current.clear()

      for (let index = 0; index < entries.length; index += 1) {
        const [regionId, pending] = entries[index]

        try {
          const saved = await patchRegion(
            image.id,
            regionId,
            pending.patch,
          )
          if (stateRef.current.activeImage?.id !== image.id) return

          if (
            regionVersionsRef.current.get(regionId) === pending.version
          ) {
            const nextRegions = regionsRef.current.map((region) =>
              region.id === regionId ? saved : region,
            )
            regionsRef.current = nextRegions
            setState((previous) => ({
              ...previous,
              regions: nextRegions,
            }))
          }
        } catch (error) {
          if (stateRef.current.activeImage?.id !== image.id) return
          if (recoverRegionSaveFailure(error)) return

          const newerPatch =
            pendingRegionPatchesRef.current.get(regionId)
          if (newerPatch !== undefined) {
            pendingRegionPatchesRef.current.set(regionId, {
              patch: { ...pending.patch, ...newerPatch.patch },
              version: newerPatch.version,
            })
          } else if (
            regionVersionsRef.current.get(regionId) === pending.version
          ) {
            pendingRegionPatchesRef.current.set(regionId, pending)
          }

          for (const [restId, rest] of entries.slice(index + 1)) {
            const newerRest =
              pendingRegionPatchesRef.current.get(restId)
            if (newerRest !== undefined) {
              pendingRegionPatchesRef.current.set(restId, {
                patch: { ...rest.patch, ...newerRest.patch },
                version: newerRest.version,
              })
            } else if (
              regionVersionsRef.current.get(restId) === rest.version
            ) {
              pendingRegionPatchesRef.current.set(restId, rest)
            }
          }

          showRegionSaveError(regionId, error)
          throw error
        }
      }

      clearRegionSaveBanner()
    })
  }, [
    clearRegionSaveBanner,
    enqueueRegionSetSave,
    recoverRegionSaveFailure,
    regionQueue,
    showRegionSaveError,
  ])

  const enqueueCalibrationSave = useCallback(() => {
    const pending = pendingCalibrationRef.current
    if (pending === null) return

    pendingCalibrationRef.current = null

    calibrationQueue.schedule(async () => {
      const image = stateRef.current.activeImage
      if (image === null) return
      if (
        calibrationsMatch(
          pending.payload,
          lastSavedCalibrationRef.current,
        )
      ) {
        return
      }

      try {
        const saved = await updateImage(image.id, {
          calibration: pending.payload,
        })
        if (stateRef.current.activeImage?.id !== image.id) return

        lastSavedCalibrationRef.current = saved.calibration
        if (calibrationVersionRef.current === pending.version) {
          setCalibrationState(
            saved.calibration === null
              ? null
              : { ...saved.calibration, image_id: image.id },
          )
        }
        clearCalibrationSaveBanner()
      } catch (error) {
        if (stateRef.current.activeImage?.id !== image.id) return
        if (calibrationVersionRef.current === pending.version) {
          pendingCalibrationRef.current = pending
        }
        if (recoverImageSaveFailure(error)) return
        showCalibrationSaveError(error)
        throw error
      }
    })
  }, [
    calibrationQueue,
    clearCalibrationSaveBanner,
    recoverImageSaveFailure,
    setCalibrationState,
    showCalibrationSaveError,
  ])

  const enqueueWorkspaceSaves = useCallback(() => {
    clearRegionSaveTimers()

    if (pendingRegionSetRef.current) {
      enqueueRegionSetSave()
    } else {
      enqueueRegionPatchSave()
    }
    enqueueCalibrationSave()
  }, [
    clearRegionSaveTimers,
    enqueueCalibrationSave,
    enqueueRegionPatchSave,
    enqueueRegionSetSave,
  ])

  const updateRegion = useCallback(
    (regionId: string, patch: RegionPatchPayload) => {
      const image = stateRef.current.activeImage
      if (image === null) return
      if (!regionsRef.current.some((region) => region.id === regionId)) {
        return
      }

      const version = (regionVersionsRef.current.get(regionId) ?? 0) + 1
      regionVersionsRef.current.set(regionId, version)
      regionSetVersionRef.current += 1

      const pending = pendingRegionPatchesRef.current.get(regionId)
      const mergedPatch = pending
        ? { ...pending.patch, ...patch }
        : patch
      pendingRegionPatchesRef.current.set(regionId, {
        patch: mergedPatch,
        version,
      })

      if (isVisualRegionPatch(patch)) markVisualDirty()
      applyRegionPatchState(regionId, patch)

      if (
        saveErrorInfoRef.current?.resource === 'regions' &&
        saveErrorInfoRef.current.regionId === regionId
      ) {
        saveErrorInfoRef.current = null
      }
      publishSaveState()

      if (
        pendingRegionSetRef.current ||
        regionSetSavingRef.current
      ) {
        pendingRegionSetRef.current = true
        if (regionSaveTimerRef.current !== null) {
          window.clearTimeout(regionSaveTimerRef.current)
        }
        regionSaveTimerRef.current = window.setTimeout(() => {
          regionSaveTimerRef.current = null
          enqueueRegionSetSave()
        }, 600)
        return
      }

      if (regionSaveTimerRef.current !== null) {
        window.clearTimeout(regionSaveTimerRef.current)
      }
      regionSaveTimerRef.current = window.setTimeout(() => {
        regionSaveTimerRef.current = null
        enqueueRegionPatchSave()
      }, 600)
    },
    [
      applyRegionPatchState,
      enqueueRegionPatchSave,
      enqueueRegionSetSave,
      markVisualDirty,
      publishSaveState,
    ],
  )

  const updateRegions = useCallback(
    (updates: Array<{ regionId: string; patch: RegionPatchPayload }>) => {
      if (stateRef.current.activeImage === null) return

      const patches = new Map<string, RegionPatchPayload>()
      for (const update of updates) {
        if (
          !regionsRef.current.some(
            (region) => region.id === update.regionId,
          )
        ) {
          continue
        }
        const existing = patches.get(update.regionId)
        patches.set(
          update.regionId,
          existing === undefined
            ? update.patch
            : { ...existing, ...update.patch },
        )
      }
      if (patches.size === 0) return

      regionSetVersionRef.current += 1
      pendingRegionSetRef.current = true
      for (const regionId of patches.keys()) {
        regionVersionsRef.current.set(
          regionId,
          (regionVersionsRef.current.get(regionId) ?? 0) + 1,
        )
        pendingRegionPatchesRef.current.delete(regionId)
      }

      const nextRegions = regionsRef.current.map((region) => {
        const patch = patches.get(region.id)
        return patch === undefined ? region : { ...region, ...patch }
      })
      regionsRef.current = nextRegions
      setState((previous) => ({ ...previous, regions: nextRegions }))
      markVisualDirty()

      if (saveErrorInfoRef.current?.resource === 'regions') {
        saveErrorInfoRef.current = null
      }
      publishSaveState()

      if (regionSaveTimerRef.current !== null) {
        window.clearTimeout(regionSaveTimerRef.current)
      }
      regionSaveTimerRef.current = window.setTimeout(() => {
        regionSaveTimerRef.current = null
        enqueueRegionSetSave()
      }, 600)
    },
    [
      enqueueRegionSetSave,
      markVisualDirty,
      publishSaveState,
    ],
  )

  const deleteRegion = useCallback(
    (regionId: string) => {
      const image = stateRef.current.activeImage
      if (image === null) return
      if (!regionsRef.current.some((region) => region.id === regionId)) {
        return
      }

      regionSetVersionRef.current += 1
      regionVersionsRef.current.delete(regionId)
      pendingRegionPatchesRef.current.delete(regionId)
      pendingRegionSetRef.current = true

      replaceRegionsState(
        regionsRef.current.filter((region) => region.id !== regionId),
      )
      markVisualDirty()

      if (saveErrorInfoRef.current?.resource === 'regions') {
        saveErrorInfoRef.current = null
      }
      publishSaveState()

      if (regionSaveTimerRef.current !== null) {
        window.clearTimeout(regionSaveTimerRef.current)
      }
      regionSaveTimerRef.current = window.setTimeout(() => {
        regionSaveTimerRef.current = null
        enqueueRegionSetSave()
      }, 600)
    },
    [
      enqueueRegionSetSave,
      markVisualDirty,
      publishSaveState,
      replaceRegionsState,
    ],
  )

  const appendLocalRegion = useCallback(
    (region: Region) => {
      regionSetVersionRef.current += 1
      pendingRegionSetRef.current = true
      const nextRegions = [...regionsRef.current, region]
      regionsRef.current = nextRegions
      selectedRegionIdRef.current = region.id

      setState((previous) => ({
        ...previous,
        regions: nextRegions,
        selectedRegionId: region.id,
      }))
      markVisualDirty()

      if (saveErrorInfoRef.current?.resource === 'regions') {
        saveErrorInfoRef.current = null
      }
      publishSaveState()

      if (regionSaveTimerRef.current !== null) {
        window.clearTimeout(regionSaveTimerRef.current)
      }
      regionSaveTimerRef.current = window.setTimeout(() => {
        regionSaveTimerRef.current = null
        enqueueRegionSetSave()
      }, 600)
    },
    [enqueueRegionSetSave, markVisualDirty, publishSaveState],
  )

  const createRegion = useCallback(
    (input: NewRegionInput): string => {
      if (stateRef.current.activeImage === null) return ''

      const regionId = `${LOCAL_REGION_PREFIX}${++localRegionCounterRef.current}`
      const sortOrder =
        regionsRef.current.reduce(
          (highest, region) => Math.max(highest, region.sort_order),
          -1,
        ) + 1
      const region: Region = {
        id: regionId,
        image_id: stateRef.current.activeImage.id,
        name: input.name.trim().slice(0, 80),
        sort_order: sortOrder,
        geometry_type: input.geometry_type,
        geometry_json: input.geometry_json,
        surface_type: input.surface_type,
        region_role: input.region_role,
        manual_area_sqft: null,
        manual_length_ft: null,
        deduction_sqft: 0,
        material_id: null,
        color_hex: null,
        material_rate_override: null,
        labor_rate_override: null,
      }

      appendLocalRegion(region)
      return regionId
    },
    [appendLocalRegion],
  )

  const updateCalibration = useCallback(
    (payload: CalibrationPayload | null) => {
      const image = stateRef.current.activeImage
      if (image === null) return

      const version = calibrationVersionRef.current + 1
      calibrationVersionRef.current = version
      const savePending =
        calibrationQueue.isBusy() ||
        pendingCalibrationRef.current !== null
      const changed =
        savePending ||
        !calibrationsMatch(payload, lastSavedCalibrationRef.current)

      if (changed) {
        pendingCalibrationRef.current = { payload, version }
        markVisualDirty()
      } else {
        pendingCalibrationRef.current = null
      }

      setCalibrationState(
        payload === null ? null : { ...payload, image_id: image.id },
      )

      if (saveErrorInfoRef.current?.resource === 'calibration') {
        saveErrorInfoRef.current = null
      }
      publishSaveState()

      if (!changed) return

      if (calibrationSaveTimerRef.current !== null) {
        window.clearTimeout(calibrationSaveTimerRef.current)
      }
      calibrationSaveTimerRef.current = window.setTimeout(() => {
        calibrationSaveTimerRef.current = null
        enqueueCalibrationSave()
      }, 600)
    },
    [
      calibrationQueue,
      enqueueCalibrationSave,
      markVisualDirty,
      publishSaveState,
      setCalibrationState,
    ],
  )

  const scheduleTitleSave = useCallback(
    (projectId: string) => {
      const version = titleVersionRef.current
      titleSaveActiveRef.current = true

      titleQueue.schedule(async () => {
        if (stateRef.current.project?.id !== projectId) return

        const title = titleDraftRef.current.trim()
        if (!title) return

        const saved = await renameProject(projectId, { title })
        if (version !== titleVersionRef.current) return

        setState((previous) => {
          if (previous.project?.id !== saved.id) return previous
          return {
            ...previous,
            project: {
              ...previous.project,
              title: saved.title,
              updated_at: saved.updated_at,
            },
            projectTitleDraft:
              previous.projectTitleDraft.trim() === saved.title
                ? saved.title
                : previous.projectTitleDraft,
          }
        })
      })
    },
    [titleQueue],
  )

  const setProjectTitleDraft = useCallback(
    (value: string) => {
      titleDraftRef.current = value
      titleVersionRef.current += 1
      clearTitleTimer()
      setState((previous) => ({ ...previous, projectTitleDraft: value }))

      const project = stateRef.current.project
      if (project === null) {
        publishSaveState()
        return
      }

      const trimmed = value.trim()
      if (!trimmed) {
        publishSaveState()
        return
      }
      if (trimmed === project.title && !titleSaveActiveRef.current) {
        publishSaveState()
        return
      }

      titleTimerRef.current = window.setTimeout(() => {
        titleTimerRef.current = null
        scheduleTitleSave(project.id)
      }, 600)
      publishSaveState()
    },
    [clearTitleTimer, publishSaveState, scheduleTitleSave],
  )

  const commitProjectTitle = useCallback(async () => {
    clearTitleTimer()
    const project = stateRef.current.project
    if (project === null) return

    const trimmed = titleDraftRef.current.trim()
    if (!trimmed) {
      titleDraftRef.current = project.title
      setState((previous) => ({
        ...previous,
        projectTitleDraft: project.title,
      }))
      if (titleQueue.isBusy() || titleQueue.hasFailed()) {
        scheduleTitleSave(project.id)
      }
      await titleQueue.flush()
      return
    }

    if (trimmed !== project.title || titleSaveActiveRef.current) {
      scheduleTitleSave(project.id)
    }
    await titleQueue.flush()
  }, [clearTitleTimer, scheduleTitleSave, titleQueue])

  const flushSaves = useCallback(async (): Promise<boolean> => {
    clearTitleTimer()
    const project = stateRef.current.project

    if (project !== null) {
      const trimmed = titleDraftRef.current.trim()
      if (!trimmed) {
        titleDraftRef.current = project.title
        setState((previous) => ({
          ...previous,
          projectTitleDraft: project.title,
        }))
        if (titleQueue.isBusy() || titleQueue.hasFailed()) {
          scheduleTitleSave(project.id)
        }
      } else if (
        trimmed !== project.title ||
        titleSaveActiveRef.current
      ) {
        scheduleTitleSave(project.id)
      }
    }

    enqueueWorkspaceSaves()

    const [titleSaved, regionsSaved, calibrationSaved] =
      await Promise.all([
        titleQueue.flushOrRetry(),
        regionQueue.flushOrRetry(),
        calibrationQueue.flushOrRetry(),
      ])

    return titleSaved && regionsSaved && calibrationSaved
  }, [
    clearTitleTimer,
    enqueueWorkspaceSaves,
    scheduleTitleSave,
    titleQueue,
    regionQueue,
    calibrationQueue,
  ])

  const retrySave = useCallback(async () => {
    const retries: Promise<boolean>[] = []

    if (titleQueue.hasFailed()) {
      titleSaveActiveRef.current = true
      retries.push(titleQueue.retry())
    }
    if (regionQueue.hasFailed()) {
      retries.push(regionQueue.retry())
    }
    if (calibrationQueue.hasFailed()) {
      retries.push(calibrationQueue.retry())
    }

    await Promise.all(retries)
  }, [titleQueue, regionQueue, calibrationQueue])

  const startProject = useCallback(
    async (title?: string) => {
      loadAbortRef.current?.abort()
      loadAbortRef.current = null
      clearTitleTimer()
      revokeFinalPreviewUrl()
      resetWorkspaceData()
      invalidLinkRef.current = false

      const trimmed = title?.trim() ?? ''
      const created = await createProject(
        trimmed ? { title: trimmed } : {},
      )
      const project: ProjectDetail = { ...created, images: [] }

      titleDraftRef.current = created.title
      titleVersionRef.current += 1
      resetSaveTracking('saved')

      setState({
        ...EMPTY_STATE,
        project,
        projectTitleDraft: created.title,
        step: 'upload',
        loading: false,
        saveState: 'saved',
        materialsLoading: true,
        finalPreviewStatus: 'absent',
      })

      replaceProjectUrl(created.id, 'upload')

      try {
        const catalog = await getMaterials()
        setState((previous) =>
          previous.project?.id === created.id
            ? {
                ...previous,
                materials: catalog.materials,
                materialsLoading: false,
              }
            : previous,
        )
      } catch (error) {
        if (isAbortError(error)) return
        if (stateRef.current.project?.id !== created.id) return
        setState((previous) =>
          previous.project?.id === created.id
            ? { ...previous, materialsLoading: false }
            : previous,
        )
        showBanner({
          tone: 'warning',
          title: 'Materials did not load',
          message: getErrorMessage(error),
          actionLabel: 'Retry',
          action: () => {
            void reloadMaterialsRef.current()
          },
        })
      }
    },
    [
      clearTitleTimer,
      resetSaveTracking,
      resetWorkspaceData,
      revokeFinalPreviewUrl,
      showBanner,
    ],
  )

  const uploadProjectPhoto = useCallback(
    async (
      file: File,
      options?: UploadOptions,
    ): Promise<ImageUpload> => {
      const project = stateRef.current.project
      if (project === null) {
        throw new ApiError({
          status: 0,
          code: 'PROJECT_NOT_OPEN',
          message: 'Open a project before adding a photo.',
        })
      }

      const uploaded = await uploadProjectImage(project.id, file, options)
      const image: ProjectImage = {
        id: uploaded.id,
        sort_order: uploaded.sort_order,
        width: uploaded.width,
        height: uploaded.height,
        created_at: uploaded.created_at,
      }

      revokeFinalPreviewUrl()
      resetRegionData()
      setState((previous) => {
        if (previous.project?.id !== project.id) return previous

        const images = [
          ...previous.project.images.filter(
            (existing) => existing.id !== image.id,
          ),
          image,
        ].sort(
          (first, second) => first.sort_order - second.sort_order,
        )

        return {
          ...previous,
          project: { ...previous.project, images },
          activeImage: image,
          calibration: null,
          regions: [],
          selectedRegionId: null,
          finalPreviewStatus: 'absent',
          finalPreviewBlob: null,
          finalPreviewUrl: null,
          saveErrorInfo: null,
          visualDirty: false,
        }
      })

      replaceImageUrl(image.id)

      // The upload already committed. Refresh the project so a concurrent
      // photo list stays accurate, but keep the local title draft untouched.
      try {
        const refreshed = await getProject(project.id)
        setState((previous) => {
          if (previous.project?.id !== refreshed.id) return previous

          const activeId = previous.activeImage?.id ?? image.id
          const activeImage =
            refreshed.images.find(
              (candidate) => candidate.id === activeId,
            ) ?? image

          return {
            ...previous,
            project: {
              ...refreshed,
              title: previous.project.title,
            },
            activeImage,
          }
        })
      } catch {
        // The optimistic upload state is enough if the refresh fails.
      }

      return uploaded
    },
    [resetRegionData, revokeFinalPreviewUrl],
  )

  const startOver = useCallback(() => {
    loadAbortRef.current?.abort()
    loadAbortRef.current = null
    clearTitleTimer()
    revokeFinalPreviewUrl()
    clearProjectUrl()
    invalidLinkRef.current = false
    resetWorkspaceData()
    titleDraftRef.current = ''
    titleVersionRef.current += 1
    setState({ ...EMPTY_STATE, loading: false })
  }, [
    clearTitleTimer,
    resetWorkspaceData,
    revokeFinalPreviewUrl,
  ])

  const retryLoad = useCallback(async () => {
    await restoreWorkspace(true)
  }, [restoreWorkspace])

  const copyProjectLink = useCallback(async (): Promise<CopyLinkResult> => {
    const saved = await flushSaves()
    if (!saved) {
      showBanner({
        tone: 'error',
        title: 'Changes are not saved',
        message:
          'Retry the save before copying the link so it opens the latest version.',
      })
      return 'blocked'
    }

    const url = window.location.href
    if (!navigator.clipboard?.writeText) {
      showToast('Select the link and copy it.', 'info')
      return 'manual'
    }

    try {
      await navigator.clipboard.writeText(url)
      showToast('Link copied.', 'success')
      return 'copied'
    } catch {
      showToast('Select the link and copy it.', 'info')
      return 'manual'
    }
  }, [flushSaves, showBanner, showToast])

  const setFinalPreviewBlob = useCallback(
    (blob: Blob) => {
      revokeFinalPreviewUrl()
      const url = URL.createObjectURL(blob)
      finalPreviewUrlRef.current = url
      setState((previous) => ({
        ...previous,
        finalPreviewBlob: blob,
        finalPreviewUrl: url,
        finalPreviewStatus: 'fresh',
        visualDirty: false,
      }))
    },
    [revokeFinalPreviewUrl],
  )

  const clearFinalPreview = useCallback(() => {
    revokeFinalPreviewUrl()
    setState((previous) => ({
      ...previous,
      finalPreviewBlob: null,
      finalPreviewUrl: null,
      finalPreviewStatus:
        previous.activeImage === null ? 'unknown' : 'absent',
    }))
  }, [revokeFinalPreviewUrl])

  const ensureFinalPreview = useCallback(async (): Promise<FinalPreviewStatus> => {
    const image = stateRef.current.activeImage
    if (image === null) return 'unknown'

    const inFlight = ensureFinalPreviewPromiseRef.current
    if (inFlight?.imageId === image.id) return inFlight.promise

    const promise = (async (): Promise<FinalPreviewStatus> => {
      let status = stateRef.current.finalPreviewStatus
      const activeImageChanged = () =>
        stateRef.current.activeImage?.id !== image.id

      if (status === 'unknown') {
        status = await refreshFinalPreview()
        if (activeImageChanged()) return 'unknown'
        if (status !== 'absent') return status
      }

      if (status === 'missing-image' || status === 'checking') {
        return status
      }

      if (status === 'fresh' && !stateRef.current.visualDirty) {
        if (stateRef.current.finalPreviewUrl !== null) return 'fresh'
        const refreshed = await refreshFinalPreview()
        if (activeImageChanged()) return 'unknown'
        if (refreshed !== 'absent') return refreshed
      }

      const runId = ++finalizeRunRef.current
      revokeFinalPreviewUrl()
      setState((previous) => ({
        ...previous,
        finalizing: true,
        finalPreviewStatus: 'checking',
        finalPreviewBlob: null,
        finalPreviewUrl: null,
      }))

      try {
        await finalizeImage(image.id)
      } catch (error) {
        if (activeImageChanged()) return 'unknown'
        const nextStatus: FinalPreviewStatus =
          error instanceof ApiError && error.code === 'IMAGE_NOT_FOUND'
            ? 'missing-image'
            : 'error'
        setState((previous) => ({
          ...previous,
          finalPreviewStatus: nextStatus,
        }))
        showBanner({
          tone: 'error',
          title: 'The final image could not be rendered',
          message: getErrorMessage(error),
          actionLabel: 'Retry',
          action: () => {
            void ensureFinalPreviewRef.current()
          },
        })
        return nextStatus
      } finally {
        if (finalizeRunRef.current === runId) {
          setState((previous) => ({ ...previous, finalizing: false }))
        }
      }

      if (activeImageChanged()) return 'unknown'

      setState((previous) => ({ ...previous, visualDirty: false }))

      try {
        const blob = await getFinalPreview(image.id)
        if (activeImageChanged()) return 'unknown'
        setFinalPreviewBlob(blob)
        return 'fresh'
      } catch (error) {
        if (activeImageChanged()) return 'unknown'
        const nextStatus: FinalPreviewStatus =
          error instanceof ApiError && error.code === 'IMAGE_NOT_FOUND'
            ? 'missing-image'
            : 'error'
        setState((previous) => ({
          ...previous,
          finalPreviewStatus: nextStatus,
        }))
        showBanner({
          tone: 'error',
          title: 'The final image could not be loaded',
          message: getErrorMessage(error),
          actionLabel: 'Retry',
          action: () => {
            void ensureFinalPreviewRef.current()
          },
        })
        return nextStatus
      }
    })()

    ensureFinalPreviewPromiseRef.current = { imageId: image.id, promise }
    try {
      return await promise
    } finally {
      if (ensureFinalPreviewPromiseRef.current?.promise === promise) {
        ensureFinalPreviewPromiseRef.current = null
      }
    }
  }, [refreshFinalPreview, revokeFinalPreviewUrl, setFinalPreviewBlob, showBanner])

  useEffect(() => {
    ensureFinalPreviewRef.current = ensureFinalPreview
  }, [ensureFinalPreview])

  const selectImage = useCallback(
    async (imageId: string): Promise<boolean> => {
      if (navigationRef.current) return false

      const current = stateRef.current
      const currentProject = current.project
      if (currentProject === null || current.activeImage?.id === imageId) {
        return false
      }

      const image = currentProject.images.find(
        (candidate) => candidate.id === imageId,
      )
      if (image === undefined) {
        showToast('That photo is not part of this project.', 'info')
        return false
      }

      navigationRef.current = true
      const requestVersion = ++imageSwitchVersionRef.current

      try {
        const saved = await flushSaves()
        if (!saved) {
          showToast('Retry the save before switching photos.', 'error')
          return false
        }

        const [calibrationResult, regionsResult, previewResult] =
          await Promise.allSettled([
            getCalibration(image.id),
            getRegions(image.id),
            getFinalPreview(image.id),
          ])

        if (
          imageSwitchVersionRef.current !== requestVersion ||
          stateRef.current.project?.id !== currentProject.id
        ) {
          return false
        }

        let calibration: Calibration | null = null
        let calibrationFailed = false
        if (calibrationResult.status === 'fulfilled') {
          calibration = calibrationResult.value
        } else if (!isAbortError(calibrationResult.reason)) {
          const reason = calibrationResult.reason
          calibrationFailed =
            !(reason instanceof ApiError) ||
            (reason.code !== 'CALIBRATION_NOT_FOUND' &&
              reason.code !== 'IMAGE_NOT_FOUND')
        }

        let regions: Region[] = []
        let regionsError: string | null = null
        if (regionsResult.status === 'fulfilled') {
          regions = regionsResult.value.regions.map(normalizeRegion)
        } else if (!isAbortError(regionsResult.reason)) {
          regionsError = getErrorMessage(regionsResult.reason)
        }

        let finalPreviewStatus: FinalPreviewStatus = 'absent'
        let finalPreviewBlob: Blob | null = null
        let finalPreviewUrl: string | null = null
        let previewError: string | null = null

        if (previewResult.status === 'fulfilled') {
          finalPreviewBlob = previewResult.value
          finalPreviewUrl = URL.createObjectURL(previewResult.value)
          finalPreviewStatus = 'fresh'
        } else if (!isAbortError(previewResult.reason)) {
          const reason = previewResult.reason
          if (
            reason instanceof ApiError &&
            reason.code === 'FINAL_PREVIEW_NOT_FOUND'
          ) {
            finalPreviewStatus = 'absent'
          } else if (
            reason instanceof ApiError &&
            reason.code === 'IMAGE_NOT_FOUND'
          ) {
            finalPreviewStatus = 'missing-image'
          } else {
            finalPreviewStatus = 'error'
            previewError = getErrorMessage(reason)
          }
        }

        const resolved = resolveStep(readUrlState().step, {
          activeImage: image,
          regions,
          calibration,
          finalPreviewStatus,
          visualDirty: false,
        })

        revokeFinalPreviewUrl()
        resetRegionData()
        resetSaveTracking('saved')

        regionsRef.current = regions
        calibrationRef.current = calibration
        lastSavedCalibrationRef.current = calibration
        const selectedRegionId = regions[0]?.id ?? null
        selectedRegionIdRef.current = selectedRegionId
        if (finalPreviewUrl !== null) {
          finalPreviewUrlRef.current = finalPreviewUrl
        }

        replaceStepUrl(resolved)
        replaceImageUrl(image.id)

        setState((previous) => ({
          ...previous,
          activeImage: image,
          calibration,
          regions,
          selectedRegionId,
          finalPreviewStatus,
          finalPreviewBlob,
          finalPreviewUrl,
          step: resolved,
          saveState: 'saved',
          saveError: null,
          saveErrorInfo: null,
          visualDirty: false,
          finalizing: false,
        }))

        if (regionsError !== null) {
          showBanner({
            tone: 'error',
            title: 'Regions did not load',
            message: regionsError,
            actionLabel: 'Retry',
            action: () => {
              void refreshRegionsRef.current()
            },
          })
        }
        if (previewError !== null) {
          showBanner({
            tone: 'warning',
            title: 'Could not check the final image',
            message: previewError,
            actionLabel: 'Retry',
            action: () => {
              void refreshFinalPreviewRef.current()
            },
          })
        }
        if (calibrationFailed) {
          showBanner({
            tone: 'warning',
            title: 'The scale did not load',
            message:
              'This photo opened without its calibration. Set the calibration again if the measurements look wrong.',
          })
        }
        return true
      } finally {
        navigationRef.current = false
      }
    },
    [
      flushSaves,
      resetRegionData,
      resetSaveTracking,
      revokeFinalPreviewUrl,
      showBanner,
      showToast,
    ],
  )

  const reorderImages = useCallback(
    async (movedImageId: string, targetImageId: string): Promise<void> => {
      const current = stateRef.current
      const project = current.project
      if (project === null || movedImageId === targetImageId) return

      const ordered = sortProjectImages(project.images)
      const fromIndex = ordered.findIndex(
        (image) => image.id === movedImageId,
      )
      const toIndex = ordered.findIndex(
        (image) => image.id === targetImageId,
      )
      if (fromIndex < 0 || toIndex < 0) return

      const moved = ordered[fromIndex]
      const reordered = ordered.filter(
        (image) => image.id !== movedImageId,
      )
      reordered.splice(toIndex, 0, moved)
      const reindexed = reordered.map((image, index) => ({
        ...image,
        sort_order: index,
      }))

      setState((previous) => {
        if (previous.project?.id !== project.id) return previous
        return {
          ...previous,
          project: { ...previous.project, images: reindexed },
        }
      })

      try {
        await Promise.all(
          reindexed.map((image) =>
            updateImage(image.id, { sort_order: image.sort_order }),
          ),
        )
      } catch (error) {
        showToast(
          error instanceof ApiError
            ? `Could not save the new photo order. ${error.message}`
            : 'Could not save the new photo order.',
          'error',
        )
        try {
          const refreshed = await getProject(project.id)
          setState((previous) =>
            previous.project?.id === refreshed.id
              ? {
                  ...previous,
                  project: {
                    ...refreshed,
                    title: previous.project.title,
                  },
                }
              : previous,
          )
        } catch {
          // Keep the optimistic order; a reload restores the server order.
        }
      }
    },
    [showToast],
  )

  const deleteImage = useCallback(
    async (imageId: string): Promise<void> => {
      const current = stateRef.current
      const project = current.project
      if (project === null) return
      if (project.images.length <= 1) {
        showToast('A project needs at least one photo.', 'info')
        return
      }

      const ordered = sortProjectImages(project.images)
      const imageIndex = ordered.findIndex((image) => image.id === imageId)
      if (imageIndex < 0) return

      if (current.activeImage?.id === imageId) {
        const neighbor =
          ordered[imageIndex + 1] ?? ordered[imageIndex - 1]
        if (neighbor === undefined) return
        const switched = await selectImage(neighbor.id)
        if (!switched) {
          showToast('Retry once the current photo is saved.', 'error')
          return
        }
      }

      try {
        await deleteProjectImage(imageId)
      } catch (error) {
        showToast(getErrorMessage(error), 'error')
        return
      }

      setState((previous) => {
        if (previous.project === null) return previous
        const images = previous.project.images.filter(
          (image) => image.id !== imageId,
        )
        const activeImage =
          previous.activeImage?.id === imageId
            ? (sortProjectImages(images)[0] ?? null)
            : previous.activeImage
        return {
          ...previous,
          project: { ...previous.project, images },
          activeImage,
        }
      })
      showToast('Photo removed.', 'success')
    },
    [selectImage, showToast],
  )

  const continueToEstimate = useCallback(async (): Promise<boolean> => {
    if (navigationRef.current) return false
    if (stateRef.current.activeImage === null) {
      showToast('Add a photo before estimating.', 'info')
      return false
    }
    if (stateRef.current.calibration === null) {
      showToast('Set the calibration before estimating.', 'info')
      return false
    }

    navigationRef.current = true
    try {
      const saved = await flushSaves()
      if (!saved) {
        showBanner({
          tone: 'error',
          title: 'Changes are not saved',
          message: 'Retry the save before continuing.',
          actionLabel: 'Retry',
          action: () => {
            void continueToEstimateRef.current()
          },
        })
        return false
      }

      const latest = stateRef.current
      const image = latest.activeImage
      if (image === null) {
        showToast('Add a photo before estimating.', 'info')
        return false
      }

      const finishes = finishRegions(latest.regions)
      if (finishes.length === 0) {
        showToast('Mark at least one surface to cost.', 'info')
        return false
      }

      const unassigned = finishes.filter(
        (region) => region.material_id === null,
      )
      if (unassigned.length > 0) {
        selectRegion(unassigned[0].id)
        showBanner({
          tone: 'warning',
          title: 'Choose a material first',
          message: `${unassigned
            .map((region) => region.name)
            .join(', ')} ${
            unassigned.length === 1 ? 'still needs' : 'still need'
          } a material.`,
        })
        return false
      }

      pushStepUrl('estimate')
      setState((previous) => ({ ...previous, step: 'estimate' }))
      return true
    } finally {
      navigationRef.current = false
    }
  }, [
    flushSaves,
    selectRegion,
    showBanner,
    showToast,
  ])
  useEffect(() => {
    continueToEstimateRef.current = continueToEstimate
  }, [continueToEstimate])

  const navigate = useCallback(
    async (target: Step) => {
      if (navigationRef.current) return
      if (target === stateRef.current.step) return

      if (target === 'estimate' && stateRef.current.step === 'materials') {
        await continueToEstimate()
        return
      }

      navigationRef.current = true
      try {
        const saved = await flushSaves()
        if (!saved) return

        const latest = stateRef.current
        if (stepIndex(target) > stepIndex(latest.step)) {
          const blocker = getStepBlocker(target, {
            activeImage: latest.activeImage,
            regions: latest.regions,
            calibration: latest.calibration,
            finalPreviewStatus: latest.finalPreviewStatus,
            visualDirty: latest.visualDirty,
          })
          if (blocker !== null) {
            showToast(blocker, 'info')
            return
          }
        }

        pushStepUrl(target)
        setState((previous) => ({ ...previous, step: target }))
      } finally {
        navigationRef.current = false
      }
    },
    [continueToEstimate, flushSaves, showToast],
  )

  useEffect(() => {
    // URL restore is the external system this effect synchronizes with.
    // oxlint-disable-next-line react/set-state-in-effect
    void restoreWorkspace()

    const handlePopState = () => {
      void (async () => {
        const saved = await flushSaves()
        if (!saved) {
          const currentProject = stateRef.current.project
          if (currentProject !== null) {
            replaceProjectUrl(
              currentProject.id,
              stateRef.current.step,
            )
          } else {
            clearProjectUrl()
          }
          return
        }
        await restoreWorkspace()
      })()
    }
    window.addEventListener('popstate', handlePopState)

    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [flushSaves, restoreWorkspace])

  useEffect(() => {
    document.title = state.project
      ? `${state.project.title} — RenoVision`
      : 'RenoVision — Exterior Renovation Planner'
  }, [state.project])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const current = stateRef.current
      const draft = titleDraftRef.current.trim()
      const titlePending =
        current.project !== null &&
        draft !== '' &&
        draft !== current.project.title

      if (
        !titlePending &&
        current.saveState !== 'saving' &&
        current.saveState !== 'error' &&
        !hasPendingSaveWork()
      ) {
        return
      }

      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [hasPendingSaveWork])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current)
      }
      clearTitleTimer()
      clearRegionSaveTimers()
      revokeFinalPreviewUrl()
      loadAbortRef.current?.abort()
    }
  }, [clearRegionSaveTimers, clearTitleTimer, revokeFinalPreviewUrl])

  return (
    <WorkspaceContext.Provider
      value={{
        ...state,
        setProjectTitleDraft,
        commitProjectTitle,
        navigate,
        selectImage,
        reorderImages,
        deleteImage,
        continueToEstimate,
        startProject,
        uploadProjectPhoto,
        startOver,
        retryLoad,
        reloadMaterials,
        refreshRegions,
        refreshFinalPreview,
        ensureFinalPreview,
        selectRegion,
        updateRegion,
        updateRegions,
        createRegion,
        deleteRegion,
        updateCalibration,
        copyProjectLink,
        showToast,
        showBanner,
        dismissBanner,
        retrySave,
        flushSaves,
        markVisualDirty,
        setFinalPreviewBlob,
        clearFinalPreview,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  )
}
