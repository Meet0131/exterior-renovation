import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Calculator,
  RotateCcw,
} from 'lucide-react'
import { ApiError, getErrorMessage, isAbortError } from '../api/client'
import { getImageEstimate, getProjectEstimate } from '../api/estimate'
import type {
  EstimateLine,
  ImageEstimate,
  Material,
  ProjectEstimate,
  Region,
} from '../api/types'
import { probePhotoEstimateFailures } from '../lib/estimateFailures'
import type { PhotoEstimateFailure } from '../lib/estimateFailures'
import { photoLabel, sortProjectImages } from '../lib/photos'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { NumberInput } from '../components/ui/NumberInput'
import { Spinner } from '../components/ui/Spinner'
import { cn } from '../lib/cn'
import {
  computeRegionGrossAreaSqFt,
  computeScaleFtPerPx,
} from '../lib/geometry'
import {
  formatMeasure,
  formatMoney,
  formatPercent,
  formatQuantity,
} from '../lib/format'
import { STEPS } from '../lib/steps'
import { useWorkspace } from '../state/useWorkspace'

type EstimateState =
  | { status: 'loading' }
  | { status: 'ready'; estimate: ImageEstimate }
  | { status: 'invalid'; message: string }
  | { status: 'error'; message: string }

type ProjectEstimateState =
  | { status: 'loading' }
  | { status: 'ready'; estimate: ProjectEstimate }
  | { status: 'invalid'; message: string; failures: PhotoEstimateFailure[] }
  | { status: 'error'; message: string }

interface DisplaySummary {
  material: number
  labor: number
  contingency: number
  grandTotal: number
  contingencyPct: number
}

interface RateDraft {
  material?: string
  labor?: string
}

interface DisplayLine extends EstimateLine {
  materialRate: number
  laborRate: number
  materialCost: number
  laborCost: number
  amount: number
  catalogMaterialRate: number
  catalogLaborRate: number
}

interface EstimateProblem {
  region: Region
  target: 'materials' | 'regions'
}

const RATE_EPSILON = 0.005

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function parseRateValue(raw: string, fallback: number): number {
  if (raw.trim() === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function ratesMatch(first: number, second: number): boolean {
  return Math.abs(first - second) < RATE_EPSILON
}

function rateInputValue(value: number): string {
  return String(Math.round(value * 10000) / 10000)
}

function findEstimateProblem(
  regions: Region[],
  materials: Material[],
  scaleFtPerPx: number | null,
  width: number,
  height: number,
): EstimateProblem | null {
  const finishes = regions.filter(
    (region) => region.region_role === 'finish',
  )

  for (const region of finishes) {
    if (region.material_id === null) {
      return { region, target: 'materials' }
    }

    const material = materials.find(
      (candidate) => candidate.id === region.material_id,
    )
    if (material === undefined) {
      if (materials.length > 0) {
        return { region, target: 'materials' }
      }
    } else if (!material.surfaces.includes(region.surface_type)) {
      return { region, target: 'materials' }
    }

    if (region.geometry_type === 'polygon') {
      if (region.manual_area_sqft !== null) continue
      if (scaleFtPerPx === null) {
        return { region, target: 'regions' }
      }
      const gross = computeRegionGrossAreaSqFt(
        region,
        scaleFtPerPx,
        width,
        height,
      )
      if (gross !== null && region.deduction_sqft > gross) {
        return { region, target: 'regions' }
      }
    } else if (
      region.manual_length_ft === null &&
      scaleFtPerPx === null
    ) {
      return { region, target: 'regions' }
    }
  }

  return null
}

function LoadingEstimate() {
  return (
    <div className="overflow-hidden rounded-[2px] border border-line bg-surface">
      <div className="border-b border-line px-4 py-3">
        <div className="h-3 w-40 animate-pulse rounded bg-surface-3" />
      </div>
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="flex flex-wrap items-center gap-4 border-b border-line px-4 py-5 last:border-b-0"
        >
          <div className="min-w-[12rem] flex-1 space-y-2">
            <div className="h-3 w-36 animate-pulse rounded bg-surface-3" />
            <div className="h-2.5 w-52 animate-pulse rounded bg-surface-2" />
          </div>
          <div className="h-9 w-24 animate-pulse rounded bg-surface-2" />
          <div className="h-9 w-24 animate-pulse rounded bg-surface-2" />
          <div className="h-4 w-20 animate-pulse rounded bg-surface-2" />
        </div>
      ))}
    </div>
  )
}

export function EstimateScreen() {
  const {
    project,
    activeImage,
    calibration,
    regions,
    materials,
    saveState,
    saveErrorInfo,
    selectRegion,
    updateRegion,
    retrySave,
    flushSaves,
    navigate,
    selectImage,
    showToast,
  } = useWorkspace()

  const [state, setState] = useState<EstimateState>({ status: 'loading' })
  const [projectState, setProjectState] = useState<ProjectEstimateState>({
    status: 'loading',
  })
  const [drafts, setDrafts] = useState<Record<string, RateDraft>>({})
  const [rateErrors, setRateErrors] = useState<Record<string, string>>({})
  const [reloadToken, setReloadToken] = useState(0)
  const [projectReloadToken, setProjectReloadToken] = useState(0)

  const requestRef = useRef(0)
  const projectRequestRef = useRef(0)
  const pendingRefreshRef = useRef(false)
  const wasSavingRef = useRef(false)

  const imageId = activeImage?.id ?? null
  const multiPhoto = (project?.images.length ?? 0) > 1
  const scaleFtPerPx =
    activeImage === null
      ? null
      : computeScaleFtPerPx(
          calibration,
          activeImage.width,
          activeImage.height,
        )

  const regionsById = useMemo(
    () => new Map(regions.map((region) => [region.id, region])),
    [regions],
  )
  const materialsById = useMemo(
    () => new Map(materials.map((material) => [material.id, material])),
    [materials],
  )

  const pruneSavedDrafts = useCallback((estimate: ImageEstimate) => {
    setDrafts((previous) => {
      if (Object.keys(previous).length === 0) return previous

      let changed = false
      const next = { ...previous }

      for (const line of estimate.lines) {
        const draft = next[line.region_id]
        if (draft === undefined) continue

        const remaining = { ...draft }
        if (draft.material !== undefined && draft.material.trim() !== '') {
          const value = Number(draft.material)
          if (
            Number.isFinite(value) &&
            ratesMatch(value, line.material_rate)
          ) {
            delete remaining.material
            changed = true
          }
        }
        if (draft.labor !== undefined && draft.labor.trim() !== '') {
          const value = Number(draft.labor)
          if (
            Number.isFinite(value) &&
            ratesMatch(value, line.labor_rate)
          ) {
            delete remaining.labor
            changed = true
          }
        }

        if (
          remaining.material === undefined &&
          remaining.labor === undefined
        ) {
          delete next[line.region_id]
        } else {
          next[line.region_id] = remaining
        }
      }

      return changed ? next : previous
    })
  }, [])

  useEffect(() => {
    if (imageId === null) return

    const requestId = ++requestRef.current
    const controller = new AbortController()

    getImageEstimate(imageId, controller.signal)
      .then((estimate) => {
        if (requestRef.current !== requestId) return
        setState({ status: 'ready', estimate })
        pruneSavedDrafts(estimate)
      })
      .catch((error: unknown) => {
        if (
          isAbortError(error) ||
          requestRef.current !== requestId
        ) {
          return
        }

        if (error instanceof ApiError && error.status === 422) {
          setState({ status: 'invalid', message: error.message })
          return
        }

        setState({
          status: 'error',
          message: getErrorMessage(error),
        })
      })

    return () => {
      controller.abort()
    }
  }, [imageId, reloadToken, pruneSavedDrafts])

  useEffect(() => {
    if (project === null || project.images.length < 2) return

    const requestId = ++projectRequestRef.current
    const controller = new AbortController()

    getProjectEstimate(project.id, controller.signal)
      .then((estimate) => {
        if (projectRequestRef.current !== requestId) return
        setProjectState({ status: 'ready', estimate })
      })
      .catch(async (error: unknown) => {
        if (
          isAbortError(error) ||
          projectRequestRef.current !== requestId
        ) {
          return
        }

        if (error instanceof ApiError && error.status === 422) {
          const failures = await probePhotoEstimateFailures(
            sortProjectImages(project.images),
          )
          if (projectRequestRef.current !== requestId) return
          setProjectState({
            status: 'invalid',
            message: error.message,
            failures,
          })
          return
        }

        setProjectState({
          status: 'error',
          message: getErrorMessage(error),
        })
      })

    return () => {
      controller.abort()
    }
  }, [imageId, project, projectReloadToken])

  useEffect(() => {
    if (saveState === 'saving') {
      wasSavingRef.current = true
      return
    }

    if (saveState === 'error') {
      wasSavingRef.current = false
      return
    }

    if (saveState === 'saved' && wasSavingRef.current) {
      wasSavingRef.current = false
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false
        setReloadToken((token) => token + 1)
        setProjectReloadToken((token) => token + 1)
      }
    }
  }, [saveState])

  const displayLines = useMemo<DisplayLine[]>(() => {
    if (state.status !== 'ready') return []

    return state.estimate.lines.map((line) => {
      const draft = drafts[line.region_id]
      const region = regionsById.get(line.region_id)
      const material =
        region?.material_id === null || region?.material_id === undefined
          ? undefined
          : materialsById.get(region.material_id)
      const catalogMaterialRate =
        material?.material_rate ?? line.material_rate
      const catalogLaborRate = material?.labor_rate ?? line.labor_rate
      const hasMaterialDraft = draft?.material !== undefined
      const hasLaborDraft = draft?.labor !== undefined
      const materialRate = hasMaterialDraft
        ? parseRateValue(draft?.material ?? '', catalogMaterialRate)
        : line.material_rate
      const laborRate = hasLaborDraft
        ? parseRateValue(draft?.labor ?? '', catalogLaborRate)
        : line.labor_rate
      const materialCost = hasMaterialDraft
        ? Math.ceil(line.purchase_qty * materialRate)
        : line.material_cost
      const laborCost = hasLaborDraft
        ? Math.ceil(line.final_measure * laborRate)
        : line.labor_cost

      return {
        ...line,
        materialRate,
        laborRate,
        materialCost,
        laborCost,
        amount: materialCost + laborCost,
        catalogMaterialRate,
        catalogLaborRate,
      }
    })
  }, [state, drafts, regionsById, materialsById])

  const summary = useMemo<DisplaySummary | null>(() => {
    if (state.status !== 'ready') return null

    if (Object.keys(drafts).length === 0) {
      return {
        material: state.estimate.subtotal_material,
        labor: state.estimate.subtotal_labor,
        contingency: state.estimate.contingency,
        grandTotal: state.estimate.grand_total,
        contingencyPct: state.estimate.contingency_pct,
      }
    }

    const material = roundMoney(
      displayLines.reduce((sum, line) => sum + line.materialCost, 0),
    )
    const labor = roundMoney(
      displayLines.reduce((sum, line) => sum + line.laborCost, 0),
    )
    const subtotal = roundMoney(material + labor)
    const contingency = roundMoney(
      (subtotal * state.estimate.contingency_pct) / 100,
    )

    return {
      material,
      labor,
      contingency,
      grandTotal: roundMoney(subtotal + contingency),
      contingencyPct: state.estimate.contingency_pct,
    }
  }, [state, drafts, displayLines])

  const projectSummary = useMemo<DisplaySummary | null>(() => {
    if (!multiPhoto || projectState.status !== 'ready') return null

    const estimate = projectState.estimate
    if (Object.keys(drafts).length === 0) {
      return {
        material: estimate.subtotal_material,
        labor: estimate.subtotal_labor,
        contingency: estimate.contingency,
        grandTotal: estimate.grand_total,
        contingencyPct: estimate.contingency_pct,
      }
    }

    const activeEntry = estimate.images.find(
      (entry) => entry.image_id === imageId,
    )
    const activeMaterial = roundMoney(
      displayLines.reduce((sum, line) => sum + line.materialCost, 0),
    )
    const activeLabor = roundMoney(
      displayLines.reduce((sum, line) => sum + line.laborCost, 0),
    )
    const material = roundMoney(
      estimate.subtotal_material -
        (activeEntry?.subtotal_material ?? 0) +
        activeMaterial,
    )
    const labor = roundMoney(
      estimate.subtotal_labor -
        (activeEntry?.subtotal_labor ?? 0) +
        activeLabor,
    )
    const subtotal = roundMoney(material + labor)
    const contingency = roundMoney(
      (subtotal * estimate.contingency_pct) / 100,
    )

    return {
      material,
      labor,
      contingency,
      grandTotal: roundMoney(subtotal + contingency),
      contingencyPct: estimate.contingency_pct,
    }
  }, [
    displayLines,
    drafts,
    imageId,
    multiPhoto,
    projectState,
  ])

  const projectPhotoRows = useMemo(() => {
    if (!multiPhoto || project === null || projectState.status !== 'ready') {
      return []
    }

    const activeMaterial = roundMoney(
      displayLines.reduce((sum, line) => sum + line.materialCost, 0),
    )
    const activeLabor = roundMoney(
      displayLines.reduce((sum, line) => sum + line.laborCost, 0),
    )
    const useDrafts = Object.keys(drafts).length > 0

    return sortProjectImages(project.images).map((image) => {
      const entry = projectState.estimate.images.find(
        (candidate) => candidate.image_id === image.id,
      )
      const isActive = image.id === imageId
      const material =
        isActive && useDrafts
          ? activeMaterial
          : (entry?.subtotal_material ?? 0)
      const labor =
        isActive && useDrafts
          ? activeLabor
          : (entry?.subtotal_labor ?? 0)

      return {
        image,
        isActive,
        material,
        labor,
        subtotal: roundMoney(material + labor),
        label: photoLabel(project.images, image.id),
      }
    })
  }, [
    displayLines,
    drafts,
    imageId,
    multiPhoto,
    project,
    projectState,
  ])

  const displayedSummary = multiPhoto ? projectSummary : summary

  const problem = useMemo(() => {
    if (activeImage === null) return null
    return findEstimateProblem(
      regions,
      materials,
      scaleFtPerPx,
      activeImage.width,
      activeImage.height,
    )
  }, [activeImage, materials, regions, scaleFtPerPx])

  const handleRateChange = useCallback(
    (line: DisplayLine, field: 'material' | 'labor', raw: string) => {
      const key = `${line.region_id}:${field}`

      if (raw !== '') {
        const value = Number(raw)
        if (!Number.isFinite(value) || value < 0) {
          setRateErrors((previous) => ({
            ...previous,
            [key]: 'Enter a rate of 0 or more.',
          }))
          return
        }
      }

      setRateErrors((previous) => {
        if (!(key in previous)) return previous
        const next = { ...previous }
        delete next[key]
        return next
      })

      setDrafts((previous) => ({
        ...previous,
        [line.region_id]: {
          ...previous[line.region_id],
          [field]: raw,
        },
      }))

      pendingRefreshRef.current = true
      const catalogRate =
        field === 'material'
          ? line.catalogMaterialRate
          : line.catalogLaborRate
      const value = Number(raw)
      const override =
        raw === '' || (Number.isFinite(value) && ratesMatch(value, catalogRate))
          ? null
          : value

      updateRegion(
        line.region_id,
        field === 'material'
          ? { material_rate_override: override }
          : { labor_rate_override: override },
      )
    },
    [updateRegion],
  )

  const handleResetRates = useCallback(
    (line: DisplayLine) => {
      setDrafts((previous) => ({
        ...previous,
        [line.region_id]: {
          material: rateInputValue(line.catalogMaterialRate),
          labor: rateInputValue(line.catalogLaborRate),
        },
      }))
      setRateErrors((previous) => {
        const next = { ...previous }
        delete next[`${line.region_id}:material`]
        delete next[`${line.region_id}:labor`]
        return next
      })

      pendingRefreshRef.current = true
      updateRegion(line.region_id, {
        material_rate_override: null,
        labor_rate_override: null,
      })
    },
    [updateRegion],
  )

  const handleFix = useCallback(() => {
    if (problem === null) return
    selectRegion(problem.region.id)
    void navigate(problem.target)
  }, [navigate, problem, selectRegion])

  const handleRetryLoad = useCallback(() => {
    setState({ status: 'loading' })
    setReloadToken((token) => token + 1)
  }, [])

  const handleContinueToReport = useCallback(async () => {
    const saved = await flushSaves()
    if (!saved) {
      showToast('Retry the rate save before continuing.', 'error')
      return
    }
    await navigate('report')
  }, [flushSaves, navigate, showToast])

  if (project === null) return null

  if (activeImage === null) {
    return (
      <div className="screen-enter">
        <EmptyState
          icon={<Calculator className="size-5" strokeWidth={1.8} />}
          title="Add a photo first."
          action={
            <Button
              onClick={() => {
                void navigate('upload')
              }}
            >
              Back to photo
            </Button>
          }
        />
      </div>
    )
  }

  const rateSaveFailed =
    saveState === 'error' && saveErrorInfo?.resource === 'regions'

  return (
    <div className="screen-enter">
      <header className="border-b border-line pb-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[11px] text-measure">
              Step 4 of {STEPS.length}
            </p>
            <h1 className="display mt-2 text-3xl font-bold tracking-[-0.035em] text-balance sm:text-4xl">
              Your cost estimate.
            </h1>
          </div>
        </div>
      </header>

      {state.status === 'loading' ? (
        <div className="mt-6">
          <LoadingEstimate />
        </div>
      ) : null}

      {state.status === 'invalid' ? (
        <section
          role="alert"
          className="mt-6 rounded-[2px] border border-danger/25 bg-danger-soft/70 p-5"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-danger-soft text-danger">
              <AlertTriangle className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="display text-lg font-semibold tracking-tight">
                This estimate needs a fix.
              </h2>
              <p className="mt-1 max-w-[60ch] text-sm leading-6 text-ink-2">
                {state.message}
              </p>
              {problem !== null ? (
                <p className="mt-1 text-xs text-muted">
                  Check {problem.region.name}
                  {problem.target === 'materials'
                    ? ' on the Materials screen.'
                    : ' on the Mark regions screen.'}
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                {problem !== null ? (
                  <Button onClick={handleFix}>Fix this region</Button>
                ) : null}
                <Button variant="outline" onClick={handleRetryLoad}>
                  Try again
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    void navigate('materials')
                  }}
                >
                  Back to materials
                </Button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {state.status === 'error' ? (
        <section
          role="alert"
          className="mt-6 rounded-[2px] border border-danger/25 bg-danger-soft/70 p-5"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-danger-soft text-danger">
              <AlertTriangle className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="display text-lg font-semibold tracking-tight">
                The estimate did not load.
              </h2>
              <p className="mt-1 max-w-[60ch] text-sm leading-6 text-ink-2">
                {state.message}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={handleRetryLoad}>Try again</Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    void navigate('materials')
                  }}
                >
                  Back to materials
                </Button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {multiPhoto && state.status !== 'invalid' && projectState.status === 'invalid' ? (
        <section
          role="alert"
          className="mt-6 rounded-[2px] border border-danger/25 bg-danger-soft/70 p-5"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-danger-soft text-danger">
              <AlertTriangle className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="display text-lg font-semibold tracking-tight">
                This project estimate needs a fix.
              </h2>
              <p className="mt-1 max-w-[60ch] text-sm leading-6 text-ink-2">
                {projectState.message}
              </p>
              {projectState.failures.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {projectState.failures.map((failure) => (
                    <li
                      key={failure.imageId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-[2px] border border-line bg-surface px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">
                          {photoLabel(project.images, failure.imageId)}
                        </p>
                        <p className="text-xs leading-5 text-muted">
                          {failure.message}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void selectImage(failure.imageId)
                        }}
                      >
                        Open photo
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    setProjectReloadToken((token) => token + 1)
                  }
                >
                  Try again
                </Button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {multiPhoto && projectState.status === 'error' ? (
        <section
          role="alert"
          className="mt-6 rounded-[2px] border border-danger/25 bg-danger-soft/70 p-5"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-danger-soft text-danger">
              <AlertTriangle className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="display text-lg font-semibold tracking-tight">
                The project total did not load.
              </h2>
              <p className="mt-1 max-w-[60ch] text-sm leading-6 text-ink-2">
                {projectState.message}
              </p>
              <div className="mt-4">
                <Button
                  variant="outline"
                  onClick={() =>
                    setProjectReloadToken((token) => token + 1)
                  }
                >
                  Try again
                </Button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {!multiPhoto &&
      state.status === 'ready' &&
      state.estimate.lines.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={<Calculator className="size-5" strokeWidth={1.8} />}
            title="No cost lines yet."
            action={
              <Button
                onClick={() => {
                  void navigate('materials')
                }}
              >
                Back to materials
              </Button>
            }
          />
        </div>
      ) : null}

      {state.status === 'ready' &&
      (state.estimate.lines.length > 0 || multiPhoto) ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.48fr)] lg:items-start lg:gap-8">
          <div className="min-w-0">
            {multiPhoto ? (
              <section className="mb-6">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="display text-lg font-semibold tracking-tight">
                    Photos in this estimate
                  </h2>
                </div>
                <div className="mt-3 overflow-x-auto rounded-[2px] border border-line bg-surface">
                  <table className="w-full min-w-[600px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-[13px] font-medium text-muted">
                        <th className="px-4 py-3 font-medium">Photo</th>
                        <th className="px-4 py-3 text-right font-medium">
                          Material
                        </th>
                        <th className="px-4 py-3 text-right font-medium">
                          Labour
                        </th>
                        <th className="px-4 py-3 text-right font-medium">
                          Photo subtotal
                        </th>
                        <th className="px-4 py-3 text-right font-medium">
                          <span className="sr-only">Open</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {projectPhotoRows.map((row) => (
                        <tr
                          key={row.image.id}
                          className={cn(
                            row.isActive && 'bg-pine-soft/30',
                          )}
                        >
                          <td className="px-4 py-3">
                            <span className="font-medium text-ink">
                              {row.label}
                            </span>
                            {row.isActive ? (
                              <span className="ml-2 rounded-full border border-pine/25 bg-pine-soft px-1.5 py-0.5 text-[10px] font-medium text-pine">
                                Editing
                              </span>
                            ) : null}
                          </td>
                          <td className="tabular px-4 py-3 text-right text-ink-2">
                            {formatMoney(row.material)}
                          </td>
                          <td className="tabular px-4 py-3 text-right text-ink-2">
                            {formatMoney(row.labor)}
                          </td>
                          <td className="tabular px-4 py-3 text-right font-semibold text-ink">
                            {formatMoney(row.subtotal)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {row.isActive ? null : (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  void selectImage(row.image.id)
                                }}
                              >
                                Open
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {projectState.status !== 'ready' ? (
                  <p className="mt-2 text-xs text-muted">
                    {projectState.status === 'loading'
                      ? 'Project totals are loading…'
                      : 'Project totals are unavailable until every photo can be estimated.'}
                  </p>
                ) : null}
              </section>
            ) : null}

            {state.estimate.lines.length > 0 ? (
              <>
                {multiPhoto ? (
                  <div className="mb-3">
                    <h2 className="display text-lg font-semibold tracking-tight">
                      {photoLabel(project.images, imageId ?? '')} cost lines
                    </h2>
                  </div>
                ) : null}
            <div className="overflow-x-auto rounded-[2px] border border-line bg-surface">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[13px] font-medium text-muted">
                    <th className="w-[34%] min-w-[220px] px-4 py-3 font-medium">
                      Item and material
                    </th>
                    <th className="px-4 py-3 font-medium">Quantity</th>
                    <th className="px-4 py-3 font-medium">Material rate</th>
                    <th className="px-4 py-3 font-medium">Labour rate</th>
                    <th className="px-4 py-3 text-right font-medium">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {displayLines.map((line) => {
                    const draft = drafts[line.region_id]
                    const region = regionsById.get(line.region_id)
                    const hasOverride =
                      region?.material_rate_override !== null &&
                      region?.material_rate_override !== undefined
                    const hasLaborOverride =
                      region?.labor_rate_override !== null &&
                      region?.labor_rate_override !== undefined
                    const showReset =
                      hasOverride ||
                      hasLaborOverride ||
                      draft?.material !== undefined ||
                      draft?.labor !== undefined
                    const materialError =
                      rateErrors[`${line.region_id}:material`]
                    const laborError = rateErrors[`${line.region_id}:labor`]

                    return (
                      <tr key={line.region_id} className="align-top">
                        <td className="px-4 py-4">
                          <p className="font-medium text-ink">
                            {line.region_name}
                          </p>
                          <p className="mt-0.5 text-xs leading-5 text-muted">
                            {line.material_name} ·{' '}
                            {formatMeasure(
                              line.final_measure,
                              line.measure_unit,
                            )}{' '}
                            · {formatPercent(line.waste_pct)} wastage
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <p className="tabular text-ink-2">
                            {formatQuantity(
                              line.purchase_qty,
                              line.purchase_unit,
                            )}
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-muted">₹</span>
                            <span className="w-20 shrink-0">
                              <NumberInput
                                value={
                                  draft?.material !== undefined
                                    ? draft.material
                                    : rateInputValue(line.materialRate)
                                }
                                onChange={(event) => {
                                  handleRateChange(
                                    line,
                                    'material',
                                    event.target.value,
                                  )
                                }}
                                min={0}
                                step="any"
                                aria-label={`${line.region_name} material rate`}
                                aria-invalid={materialError ? true : undefined}
                                className={cn(
                                  'h-9 px-2 text-right text-[13px]',
                                  materialError && 'border-danger',
                                )}
                              />
                            </span>
                            <span className="text-[11px] text-muted">
                              /{line.purchase_unit}
                            </span>
                          </div>
                          {materialError ? (
                            <p className="mt-1 text-[11px] text-danger">
                              {materialError}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-muted">₹</span>
                            <span className="w-20 shrink-0">
                              <NumberInput
                                value={
                                  draft?.labor !== undefined
                                    ? draft.labor
                                    : rateInputValue(line.laborRate)
                                }
                                onChange={(event) => {
                                  handleRateChange(
                                    line,
                                    'labor',
                                    event.target.value,
                                  )
                                }}
                                min={0}
                                step="any"
                                aria-label={`${line.region_name} labour rate`}
                                aria-invalid={laborError ? true : undefined}
                                className={cn(
                                  'h-9 px-2 text-right text-[13px]',
                                  laborError && 'border-danger',
                                )}
                              />
                            </span>
                            <span className="text-[11px] text-muted">
                              /{line.measure_unit}
                            </span>
                          </div>
                          {laborError ? (
                            <p className="mt-1 text-[11px] text-danger">
                              {laborError}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-4 text-right">
                          <p className="tabular font-semibold text-ink">
                            {formatMoney(line.amount)}
                          </p>
                          {showReset ? (
                            <button
                              type="button"
                              onClick={() => handleResetRates(line)}
                              className="mt-1 inline-flex items-center gap-1 text-[11px] text-measure hover:text-pine"
                            >
                              <RotateCcw
                                className="size-3"
                                aria-hidden="true"
                              />
                              Reset rates
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {rateSaveFailed ? (
              <div
                role="alert"
                className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[2px] border border-danger/25 bg-danger-soft/60 px-4 py-3"
              >
                <p className="text-xs font-medium text-danger">
                  Couldn&rsquo;t save this rate — your change is still
                  here.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    pendingRefreshRef.current = true
                    void retrySave()
                  }}
                >
                  Retry
                </Button>
              </div>
            ) : null}
              </>
            ) : (
              <div className="rounded-[2px] border border-line bg-surface px-5 py-8 text-center">
                <p className="display text-lg font-semibold tracking-tight">
                  No cost lines on this photo yet.
                </p>
                <Button
                  className="mt-4"
                  onClick={() => {
                    void navigate('materials')
                  }}
                >
                  Back to materials
                </Button>
              </div>
            )}
          </div>

          <aside className="min-w-0 rounded-[2px] border border-line bg-surface p-5 lg:sticky lg:top-28">
            <p className="text-xs font-medium text-muted">
              {multiPhoto ? 'Project total' : 'Estimated total'}
            </p>
            <p className="display mt-1 text-3xl font-bold tracking-[-0.03em]">
              {displayedSummary === null
                ? '—'
                : formatMoney(displayedSummary.grandTotal)}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted">
              {multiPhoto
                ? `All ${project.images.length} photos, with contingency applied once`
                : displayedSummary === null
                  ? 'The estimate is loading'
                  : `Material, labour, and ${formatPercent(displayedSummary.contingencyPct)} contingency`}
            </p>

            <dl className="mt-4 divide-y divide-line border-y border-line">
              <div className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-xs text-muted">Material</dt>
                <dd className="tabular text-sm font-medium text-ink-2">
                  {displayedSummary === null
                    ? '—'
                    : formatMoney(displayedSummary.material)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-xs text-muted">Labour</dt>
                <dd className="tabular text-sm font-medium text-ink-2">
                  {displayedSummary === null
                    ? '—'
                    : formatMoney(displayedSummary.labor)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-xs text-muted">
                  Contingency
                  {displayedSummary === null
                    ? ''
                    : ` (${formatPercent(displayedSummary.contingencyPct)})`}
                </dt>
                <dd className="tabular text-sm font-medium text-ink-2">
                  {displayedSummary === null
                    ? '—'
                    : formatMoney(displayedSummary.contingency)}
                </dd>
              </div>
            </dl>

            <Button
              className="mt-4 w-full"
              onClick={() => {
                void handleContinueToReport()
              }}
              icon={<ArrowRight className="size-4" aria-hidden="true" />}
            >
              Continue to report
            </Button>

            <p className="mt-3 text-[11px] leading-5 text-muted">
              Advisory estimate. Rates are editable placeholders for the
              prototype, not a contractor quote. Confirm site conditions
              before work begins.
            </p>
          </aside>
        </div>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <Button
          variant="ghost"
          onClick={() => {
            void navigate('materials')
          }}
          icon={<ArrowLeft className="size-4" aria-hidden="true" />}
        >
          Back to materials
        </Button>
        {state.status === 'loading' ? (
          <span className="inline-flex items-center gap-2 text-xs text-muted">
            <Spinner className="size-3.5" />
            Building the estimate…
          </span>
        ) : null}
      </div>
    </div>
  )
}
