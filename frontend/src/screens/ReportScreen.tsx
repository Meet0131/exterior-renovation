import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  FileText,
  ImageOff,
  Info,
  Link2,
} from 'lucide-react'
import { ApiError, getErrorMessage, isAbortError } from '../api/client'
import { getImageEstimate, getProjectEstimate } from '../api/estimate'
import { getFinalPreview, getSourceImage } from '../api/images'
import { getProjectReport } from '../api/report'
import type {
  ImageEstimate,
  Material,
  ProjectEstimate,
  Region,
} from '../api/types'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { Spinner } from '../components/ui/Spinner'
import { probePhotoEstimateFailures } from '../lib/estimateFailures'
import type { PhotoEstimateFailure } from '../lib/estimateFailures'
import {
  computeRegionGrossAreaSqFt,
  computeScaleFtPerPx,
} from '../lib/geometry'
import {
  formatMoney,
  formatPercent,
  formatQuantity,
} from '../lib/format'
import { photoLabel, sortProjectImages } from '../lib/photos'
import { STEPS } from '../lib/steps'
import { useWorkspace } from '../state/useWorkspace'

type EstimateState =
  | { status: 'loading' }
  | { status: 'ready'; estimate: ImageEstimate }
  | { status: 'invalid'; message: string }
  | { status: 'error'; message: string }

type PdfState =
  | { status: 'idle' }
  | { status: 'preparing' }
  | { status: 'error'; message: string; code: string | null }

type SourceState =
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'error'; message: string }

type ProjectEstimateState =
  | { status: 'loading' }
  | { status: 'ready'; estimate: ProjectEstimate }
  | { status: 'invalid'; message: string; failures: PhotoEstimateFailure[] }
  | { status: 'error'; message: string }

interface EstimateProblem {
  region: Region
  target: 'materials' | 'regions'
}

const REPORT_ESTIMATE_CODES = new Set([
  'UNASSIGNED_FINISH',
  'UNCALIBRATED_REGION',
  'MATERIAL_UNKNOWN',
  'MATERIAL_NOT_APPLICABLE',
  'NEGATIVE_NET_AREA',
])

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

function ReportLoading() {
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.48fr)]">
      <div className="min-w-0 space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map((index) => (
            <div
              key={index}
              className="aspect-[4/3] animate-pulse rounded-[2px] border border-line bg-surface-2"
            />
          ))}
        </div>
        <div className="overflow-hidden rounded-[2px] border border-line bg-surface">
          <div className="border-b border-line px-4 py-3">
            <div className="h-3 w-36 animate-pulse rounded bg-surface-3" />
          </div>
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="flex items-center gap-4 border-b border-line px-4 py-4 last:border-b-0"
            >
              <div className="h-3 w-32 animate-pulse rounded bg-surface-3" />
              <div className="h-3 w-40 animate-pulse rounded bg-surface-2" />
              <div className="ml-auto h-3 w-20 animate-pulse rounded bg-surface-2" />
            </div>
          ))}
        </div>
      </div>
      <div className="h-64 animate-pulse rounded-[2px] border border-line bg-surface" />
    </div>
  )
}

export function ReportScreen() {
  const {
    project,
    activeImage,
    calibration,
    regions,
    materials,
    finalPreviewStatus,
    finalPreviewUrl,
    ensureFinalPreview,
    flushSaves,
    copyProjectLink,
    navigate,
    selectImage,
    selectRegion,
    showToast,
    startOver,
  } = useWorkspace()

  const [sourceState, setSourceState] = useState<SourceState>({
    status: 'loading',
  })
  const [sourceReloadToken, setSourceReloadToken] = useState(0)
  const sourceUrlRef = useRef<string | null>(null)

  const [estimateState, setEstimateState] =
    useState<EstimateState>({ status: 'loading' })
  const [estimateReloadToken, setEstimateReloadToken] = useState(0)
  const estimateRequestRef = useRef(0)

  const [projectEstimateState, setProjectEstimateState] =
    useState<ProjectEstimateState>({ status: 'loading' })
  const [projectReloadToken, setProjectReloadToken] = useState(0)
  const projectEstimateRequestRef = useRef(0)

  const [pdfState, setPdfState] = useState<PdfState>({ status: 'idle' })
  const [pdfMissingPreview, setPdfMissingPreview] = useState(false)
  const [missingPhotoIds, setMissingPhotoIds] = useState<string[]>([])

  const imageId = activeImage?.id ?? null
  const multiPhoto = (project?.images.length ?? 0) > 1
  const sortedImages = useMemo(
    () => (project === null ? [] : sortProjectImages(project.images)),
    [project],
  )
  const scaleFtPerPx =
    activeImage === null
      ? null
      : computeScaleFtPerPx(
          calibration,
          activeImage.width,
          activeImage.height,
        )

  useEffect(() => {
    if (imageId === null) return

    const controller = new AbortController()
    let cancelled = false

    if (sourceUrlRef.current !== null) {
      URL.revokeObjectURL(sourceUrlRef.current)
      sourceUrlRef.current = null
    }

    getSourceImage(imageId, controller.signal)
      .then((blob) => {
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        sourceUrlRef.current = url
        setSourceState({ status: 'ready', url })
      })
      .catch((error: unknown) => {
        if (cancelled || isAbortError(error)) return
        setSourceState({
          status: 'error',
          message: getErrorMessage(error),
        })
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [imageId, sourceReloadToken])

  useEffect(() => {
    return () => {
      if (sourceUrlRef.current !== null) {
        URL.revokeObjectURL(sourceUrlRef.current)
        sourceUrlRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (imageId === null) return

    const requestId = ++estimateRequestRef.current
    const controller = new AbortController()

    getImageEstimate(imageId, controller.signal)
      .then((estimate) => {
        if (estimateRequestRef.current !== requestId) return
        setEstimateState({ status: 'ready', estimate })
      })
      .catch((error: unknown) => {
        if (
          isAbortError(error) ||
          estimateRequestRef.current !== requestId
        ) {
          return
        }

        if (error instanceof ApiError && error.status === 422) {
          setEstimateState({ status: 'invalid', message: error.message })
          return
        }

        setEstimateState({
          status: 'error',
          message: getErrorMessage(error),
        })
      })

    return () => {
      controller.abort()
    }
  }, [imageId, estimateReloadToken])

  useEffect(() => {
    if (project === null || project.images.length < 2) return

    const requestId = ++projectEstimateRequestRef.current
    const controller = new AbortController()

    getProjectEstimate(project.id, controller.signal)
      .then((estimate) => {
        if (projectEstimateRequestRef.current !== requestId) return
        setProjectEstimateState({ status: 'ready', estimate })
      })
      .catch(async (error: unknown) => {
        if (
          isAbortError(error) ||
          projectEstimateRequestRef.current !== requestId
        ) {
          return
        }

        if (error instanceof ApiError && error.status === 422) {
          const failures = await probePhotoEstimateFailures(
            sortProjectImages(project.images),
          )
          if (projectEstimateRequestRef.current !== requestId) return
          setProjectEstimateState({
            status: 'invalid',
            message: error.message,
            failures,
          })
          return
        }

        setProjectEstimateState({
          status: 'error',
          message: getErrorMessage(error),
        })
      })

    return () => {
      controller.abort()
    }
  }, [project, projectReloadToken, estimateReloadToken])

  useEffect(() => {
    if (imageId === null) return
    if (
      finalPreviewStatus === 'unknown' ||
      finalPreviewStatus === 'absent' ||
      (finalPreviewStatus === 'fresh' && finalPreviewUrl === null)
    ) {
      void ensureFinalPreview()
    }
  }, [
    imageId,
    finalPreviewStatus,
    finalPreviewUrl,
    ensureFinalPreview,
  ])

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

  const hasRailingFinish = useMemo(
    () =>
      regions.some(
        (region) =>
          region.region_role === 'finish' &&
          region.surface_type === 'railing',
      ),
    [regions],
  )

  const hasOmittedRegions = useMemo(
    () => regions.some((region) => region.region_role !== 'finish'),
    [regions],
  )

  const handleRetrySource = useCallback(() => {
    setSourceState({ status: 'loading' })
    setSourceReloadToken((token) => token + 1)
  }, [])

  const handleRetryEstimate = useCallback(() => {
    setEstimateState({ status: 'loading' })
    setEstimateReloadToken((token) => token + 1)
    setProjectReloadToken((token) => token + 1)
  }, [])

  const handleRetryProjectEstimate = useCallback(() => {
    setProjectEstimateState({ status: 'loading' })
    setProjectReloadToken((token) => token + 1)
  }, [])

  const handleRetryPreview = useCallback(() => {
    void ensureFinalPreview()
  }, [ensureFinalPreview])

  const handleFix = useCallback(() => {
    if (problem === null) return
    selectRegion(problem.region.id)
    void navigate(problem.target)
  }, [navigate, problem, selectRegion])

  const handleShare = useCallback(() => {
    void copyProjectLink()
  }, [copyProjectLink])

  const handleDownloadPdf = useCallback(async () => {
    if (project === null || pdfState.status === 'preparing') return

    setPdfState({ status: 'preparing' })
    setPdfMissingPreview(false)
    setMissingPhotoIds([])

    const saved = await flushSaves()
    if (!saved) {
      setPdfState({
        status: 'error',
        message:
          'Your latest changes are not saved. Retry the save before downloading the PDF.',
        code: 'SAVE_FAILED',
      })
      return
    }

    try {
      const file = await getProjectReport(project.id)
      const url = URL.createObjectURL(file.blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = file.filename
      anchor.rel = 'noopener'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => {
        URL.revokeObjectURL(url)
      }, 1000)
      setPdfState({ status: 'idle' })
      setPdfMissingPreview(false)
      setMissingPhotoIds([])
      showToast('PDF downloaded.', 'success')
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === 'FINAL_PREVIEW_REQUIRED'
      ) {
        setPdfMissingPreview(true)
        await ensureFinalPreview()
        const statuses = await Promise.all(
          sortedImages.map(async (image) => {
            try {
              await getFinalPreview(image.id)
              return null
            } catch (probeError) {
              if (
                probeError instanceof ApiError &&
                (probeError.code === 'FINAL_PREVIEW_NOT_FOUND' ||
                  probeError.code === 'IMAGE_NOT_FOUND')
              ) {
                return image.id
              }
              return null
            }
          }),
        )
        setMissingPhotoIds(
          statuses.filter(
            (missingId): missingId is string =>
              missingId !== null && missingId !== imageId,
          ),
        )
        setPdfState({ status: 'idle' })
        return
      }

      setPdfState({
        status: 'error',
        message: getErrorMessage(error),
        code: error instanceof ApiError ? error.code : null,
      })

      if (
        error instanceof ApiError &&
        REPORT_ESTIMATE_CODES.has(error.code)
      ) {
        setEstimateReloadToken((token) => token + 1)
        setProjectReloadToken((token) => token + 1)
      }
    }
  }, [
    ensureFinalPreview,
    flushSaves,
    imageId,
    pdfState.status,
    project,
    showToast,
    sortedImages,
  ])

  if (project === null) return null

  if (activeImage === null) {
    return (
      <div className="screen-enter">
        <EmptyState
          icon={<FileText className="size-5" strokeWidth={1.8} />}
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

  const imageGone = finalPreviewStatus === 'missing-image'
  const previewLoading =
    finalPreviewStatus === 'unknown' ||
    finalPreviewStatus === 'checking' ||
    finalPreviewStatus === 'absent' ||
    (finalPreviewStatus === 'fresh' && finalPreviewUrl === null)
  const previewReady =
    finalPreviewStatus === 'fresh' && finalPreviewUrl !== null
  const pdfPreparing = pdfState.status === 'preparing'
  const pdfEstimateError =
    pdfState.status === 'error' &&
    pdfState.code !== null &&
    REPORT_ESTIMATE_CODES.has(pdfState.code)
  const estimate =
    estimateState.status === 'ready' ? estimateState.estimate : null
  const projectEstimate =
    projectEstimateState.status === 'ready'
      ? projectEstimateState.estimate
      : null
  const displayedTotals =
    multiPhoto
      ? projectEstimate === null
        ? null
        : {
            material: projectEstimate.subtotal_material,
            labor: projectEstimate.subtotal_labor,
            contingency: projectEstimate.contingency,
            grandTotal: projectEstimate.grand_total,
            contingencyPct: projectEstimate.contingency_pct,
          }
      : estimate === null
        ? null
        : {
            material: estimate.subtotal_material,
            labor: estimate.subtotal_labor,
            contingency: estimate.contingency,
            grandTotal: estimate.grand_total,
            contingencyPct: estimate.contingency_pct,
          }
  const projectIssueVisible =
    multiPhoto &&
    projectEstimateState.status === 'invalid' &&
    estimateState.status !== 'invalid'

  const fixPath =
    problem === null
      ? null
      : `Check ${problem.region.name}${
          problem.target === 'materials'
            ? ' on the Materials screen.'
            : ' on the Mark regions screen.'
        }`

  return (
    <div className="screen-enter">
      <header className="border-b border-line pb-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[11px] text-measure">
              Step 5 of {STEPS.length}
            </p>
            <h1 className="display mt-2 text-3xl font-bold tracking-[-0.035em] text-balance sm:text-4xl">
              Your renovation report.
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={handleShare}
              icon={<Link2 className="size-4" aria-hidden="true" />}
            >
              Share link
            </Button>
            <Button
              onClick={() => {
                void handleDownloadPdf()
              }}
              loading={pdfPreparing}
              disabled={!previewReady}
              icon={<Download className="size-4" aria-hidden="true" />}
            >
              {pdfPreparing ? 'Preparing PDF…' : 'Download PDF'}
            </Button>
          </div>
        </div>
      </header>

      {multiPhoto ? (
        <div className="mt-4 flex items-start gap-2 rounded-[2px] border border-warning/30 bg-warning-soft/50 px-4 py-3 text-xs leading-5 text-ink-2">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <p>
            {project.images.length} photos. The tables cover{' '}
            {photoLabel(project.images, imageId ?? '')}; the PDF needs a
            final image for every photo.
          </p>
        </div>
      ) : null}

      {multiPhoto && pdfMissingPreview ? (
        <section
          role="alert"
          className="mt-4 rounded-[2px] border border-warning/40 bg-warning-soft/50 p-4"
        >
          <h2 className="display text-base font-semibold tracking-tight">
            Some photos need a final image.
          </h2>
          <p className="mt-1 max-w-[60ch] text-sm leading-6 text-ink-2">
            The PDF needs a current final image for every photo. Open each
            photo below to build its final image.
          </p>
          {missingPhotoIds.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {missingPhotoIds.map((missingId) => (
                <li
                  key={missingId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[2px] border border-line bg-surface px-3 py-2"
                >
                  <span className="text-sm font-medium text-ink">
                    {photoLabel(project.images, missingId)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void selectImage(missingId)
                    }}
                  >
                    Open photo
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-muted">
              A final image is missing for one of the photos. Open a photo
              from the strip to build its final image.
            </p>
          )}
        </section>
      ) : null}

      {pdfState.status === 'error' ? (
        <section
          role="alert"
          className="mt-4 rounded-[2px] border border-danger/25 bg-danger-soft/70 p-5"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-danger-soft text-danger">
              <AlertTriangle className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="display text-lg font-semibold tracking-tight">
                {pdfState.code === 'REPORT_UNAVAILABLE'
                  ? 'The PDF could not be prepared.'
                  : pdfEstimateError
                    ? 'This report needs a fix.'
                    : 'The PDF did not download.'}
              </h2>
              <p className="mt-1 max-w-[60ch] text-sm leading-6 text-ink-2">
                {pdfState.message}
              </p>
              {pdfEstimateError && fixPath !== null ? (
                <p className="mt-1 text-xs text-muted">{fixPath}</p>
              ) : null}
              {pdfEstimateError && fixPath === null && multiPhoto ? (
                <p className="mt-1 text-xs text-muted">
                  Another photo in this project needs a fix. Open it from the
                  photo list to correct the named surface.
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    void handleDownloadPdf()
                  }}
                >
                  Retry PDF
                </Button>
                {problem !== null ? (
                  <Button variant="outline" onClick={handleFix}>
                    Fix this region
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  onClick={() => {
                    void navigate('estimate')
                  }}
                >
                  Back to estimate
                </Button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {projectIssueVisible ? (
        <section
          role="alert"
          className="mt-4 rounded-[2px] border border-danger/25 bg-danger-soft/70 p-5"
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
                {projectEstimateState.status === 'invalid'
                  ? projectEstimateState.message
                  : ''}
              </p>
              {projectEstimateState.status === 'invalid' &&
              projectEstimateState.failures.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {projectEstimateState.failures.map((failure) => (
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
              <div className="mt-4">
                <Button
                  variant="outline"
                  onClick={handleRetryProjectEstimate}
                >
                  Try again
                </Button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {multiPhoto && projectEstimateState.status === 'error' ? (
        <section
          role="alert"
          className="mt-4 rounded-[2px] border border-danger/25 bg-danger-soft/70 p-5"
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
                {projectEstimateState.message}
              </p>
              <div className="mt-4">
                <Button
                  variant="outline"
                  onClick={handleRetryProjectEstimate}
                >
                  Try again
                </Button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {previewLoading ? <ReportLoading /> : null}

      {finalPreviewStatus === 'error' ? (
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
                The final image did not load.
              </h2>
              <p className="mt-1 max-w-[60ch] text-sm leading-6 text-ink-2">
                The report image could not be built. Retry before
                downloading the PDF.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={handleRetryPreview}>Try again</Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    void navigate('estimate')
                  }}
                >
                  Back to estimate
                </Button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {imageGone ? (
        <div className="mt-6">
          <EmptyState
            icon={<ImageOff className="size-5" strokeWidth={1.8} />}
            title="This photo is no longer available."
            description="The photo is no longer stored with this project. Start a new project to continue."
            action={
              <Button onClick={startOver}>Start a new project</Button>
            }
          />
        </div>
      ) : null}

      {!imageGone && previewReady ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.48fr)] lg:items-start lg:gap-8">
          <div className="min-w-0 space-y-6">
            <section className="rounded-[2px] border border-line bg-surface-2 p-3 sm:p-4">
              {multiPhoto ? (
                <div className="mb-3 px-1">
                  <p className="text-xs font-medium text-ink-2">
                    {photoLabel(project.images, imageId ?? '')} of{' '}
                    {sortedImages.length}
                  </p>
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <figure className="overflow-hidden rounded-[2px] border border-line bg-surface">
                  <div className="aspect-[4/3] bg-surface-2">
                    {sourceState.status === 'ready' ? (
                      <img
                        src={sourceState.url}
                        alt="Original facade photo"
                        className="h-full w-full object-contain"
                      />
                    ) : sourceState.status === 'error' ? (
                      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
                        <p className="text-xs text-danger">
                          {sourceState.message}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleRetrySource}
                        >
                          Retry photo
                        </Button>
                      </div>
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <Spinner className="size-4 text-muted" />
                      </div>
                    )}
                  </div>
                  <figcaption className="border-t border-line px-3 py-2 text-xs text-muted">
                    Original photo
                  </figcaption>
                </figure>

                <figure className="overflow-hidden rounded-[2px] border border-line bg-surface">
                  <div className="aspect-[4/3] bg-surface-2">
                    <img
                      src={finalPreviewUrl}
                      alt="Proposed design"
                      className="h-full w-full object-contain"
                    />
                  </div>
                  <figcaption className="flex items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs text-muted">
                    <span>Proposed design</span>
                    <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px]">
                      Stored
                    </span>
                  </figcaption>
                </figure>
              </div>
            </section>

            {estimateState.status === 'loading' ? (
              <div className="overflow-hidden rounded-[2px] border border-line bg-surface">
                <div className="border-b border-line px-4 py-3">
                  <div className="h-3 w-36 animate-pulse rounded bg-surface-3" />
                </div>
                {[0, 1, 2].map((row) => (
                  <div
                    key={row}
                    className="flex items-center gap-4 border-b border-line px-4 py-4 last:border-b-0"
                  >
                    <div className="h-3 w-32 animate-pulse rounded bg-surface-3" />
                    <div className="h-3 w-40 animate-pulse rounded bg-surface-2" />
                    <div className="ml-auto h-3 w-20 animate-pulse rounded bg-surface-2" />
                  </div>
                ))}
              </div>
            ) : null}

            {estimateState.status === 'invalid' || pdfEstimateError ? (
              <section
                role="alert"
                className="rounded-[2px] border border-danger/25 bg-danger-soft/70 p-5"
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
                      {estimateState.status === 'invalid'
                        ? estimateState.message
                        : pdfState.status === 'error'
                          ? pdfState.message
                          : ''}
                    </p>
                    {fixPath !== null ? (
                      <p className="mt-1 text-xs text-muted">{fixPath}</p>
                    ) : null}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {problem !== null ? (
                        <Button onClick={handleFix}>Fix this region</Button>
                      ) : null}
                      <Button
                        variant="outline"
                        onClick={handleRetryEstimate}
                      >
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

            {estimateState.status === 'error' ? (
              <section
                role="alert"
                className="rounded-[2px] border border-danger/25 bg-danger-soft/70 p-5"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-danger-soft text-danger">
                    <AlertTriangle className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="display text-lg font-semibold tracking-tight">
                      The report tables did not load.
                    </h2>
                    <p className="mt-1 max-w-[60ch] text-sm leading-6 text-ink-2">
                      {estimateState.message}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button onClick={handleRetryEstimate}>
                        Try again
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          void navigate('estimate')
                        }}
                      >
                        Back to estimate
                      </Button>
                    </div>
                  </div>
                </div>
              </section>
            ) : null}

            {estimate !== null ? (
              <>
                <section>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="display text-lg font-semibold tracking-tight">
                      Materials and costs
                    </h2>
                    {multiPhoto ? (
                      <p className="text-xs text-muted">
                        {photoLabel(project.images, imageId ?? '')}
                      </p>
                    ) : null}
                  </div>
                  <div className="mt-3 overflow-x-auto rounded-[2px] border border-line bg-surface">
                    <table className="w-full min-w-[760px] border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-line text-left text-[11px] font-medium text-muted">
                          <th className="px-4 py-3 font-medium">Region</th>
                          <th className="px-4 py-3 font-medium">Material</th>
                          <th className="whitespace-nowrap px-4 py-3 text-right font-medium">
                            Quantity
                          </th>
                          <th className="whitespace-nowrap px-4 py-3 text-right font-medium">
                            Material cost
                          </th>
                          <th className="whitespace-nowrap px-4 py-3 text-right font-medium">
                            Labour cost
                          </th>
                          <th className="whitespace-nowrap px-4 py-3 text-right font-medium">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {estimate.lines.map((line) => (
                          <tr
                            key={line.region_id}
                            className="transition-colors hover:bg-surface-2/40"
                          >
                            <td className="px-4 py-3 font-medium text-ink">
                              {line.region_name}
                            </td>
                            <td className="px-4 py-3 text-ink-2">
                              {line.material_name}
                            </td>
                            <td className="tabular whitespace-nowrap px-4 py-3 text-right text-ink-2">
                              {formatQuantity(
                                line.purchase_qty,
                                line.purchase_unit,
                              )}
                            </td>
                            <td className="tabular whitespace-nowrap px-4 py-3 text-right text-ink-2">
                              {formatMoney(line.material_cost)}
                            </td>
                            <td className="tabular whitespace-nowrap px-4 py-3 text-right text-ink-2">
                              {formatMoney(line.labor_cost)}
                            </td>
                            <td className="tabular whitespace-nowrap px-4 py-3 text-right font-semibold text-ink">
                              {formatMoney(line.line_total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t border-line bg-surface-2/35">
                        <tr>
                          <td
                            colSpan={2}
                            className="px-4 py-3 text-xs font-medium text-muted"
                          >
                            Photo subtotal{' '}
                            <span className="font-normal text-[11px]">
                              before contingency
                            </span>
                          </td>
                          <td className="px-4 py-3" />
                          <td className="tabular whitespace-nowrap px-4 py-3 text-right text-sm font-medium text-ink-2">
                            {formatMoney(estimate.subtotal_material)}
                          </td>
                          <td className="tabular whitespace-nowrap px-4 py-3 text-right text-sm font-medium text-ink-2">
                            {formatMoney(estimate.subtotal_labor)}
                          </td>
                          <td className="tabular whitespace-nowrap px-4 py-3 text-right text-sm font-semibold text-ink">
                            {formatMoney(
                              estimate.subtotal_material +
                                estimate.subtotal_labor,
                            )}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </section>

                <div className="flex items-start gap-2 px-1 text-xs leading-5 text-muted">
                  <Info
                    className="mt-0.5 size-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  <p>
                    The stored render paints polygon surfaces only.
                    {hasRailingFinish
                      ? ' Railings are costed but not drawn.'
                      : ''}
                    {hasOmittedRegions
                      ? ' Openings and references are not drawn.'
                      : ''}
                  </p>
                </div>
              </>
            ) : null}
          </div>

          <aside className="min-w-0 rounded-[2px] border border-line bg-surface p-5 lg:sticky lg:top-28">
            <p className="text-xs font-medium text-muted">
              {multiPhoto ? 'Project total' : 'Estimated total'}
            </p>
            <p className="display mt-1 text-3xl font-bold tracking-[-0.03em]">
              {displayedTotals !== null
                ? formatMoney(displayedTotals.grandTotal)
                : '—'}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted">
              {multiPhoto
                ? `All ${project.images.length} photos, with contingency applied once`
                : `Material, labour, and ${
                    displayedTotals !== null
                      ? formatPercent(displayedTotals.contingencyPct)
                      : '5%'
                  } contingency`}
            </p>

            <dl className="mt-4 divide-y divide-line border-y border-line">
              <div className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-xs text-muted">Material</dt>
                <dd className="tabular text-sm font-medium text-ink-2">
                  {displayedTotals !== null
                    ? formatMoney(displayedTotals.material)
                    : '—'}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-xs text-muted">Labour</dt>
                <dd className="tabular text-sm font-medium text-ink-2">
                  {displayedTotals !== null
                    ? formatMoney(displayedTotals.labor)
                    : '—'}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-xs text-muted">
                  Contingency
                  {displayedTotals !== null
                    ? ` (${formatPercent(displayedTotals.contingencyPct)})`
                    : ''}
                </dt>
                <dd className="tabular text-sm font-medium text-ink-2">
                  {displayedTotals !== null
                    ? formatMoney(displayedTotals.contingency)
                    : '—'}
                </dd>
              </div>
            </dl>

            <Button
              className="mt-4 w-full"
              onClick={() => {
                void handleDownloadPdf()
              }}
              loading={pdfPreparing}
              disabled={!previewReady}
              icon={<Download className="size-4" aria-hidden="true" />}
            >
              {pdfPreparing ? 'Preparing PDF…' : 'Download PDF'}
            </Button>

            <p className="mt-3 text-[11px] leading-5 text-muted">
              Advisory estimate. This report is a planning conversation aid,
              not a quotation or a construction contract. Confirm
              measurements, materials and pricing with a qualified
              contractor before work begins.
            </p>
          </aside>
        </div>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <Button
          variant="ghost"
          onClick={() => {
            void navigate('estimate')
          }}
          icon={<ArrowLeft className="size-4" aria-hidden="true" />}
        >
          Back to estimate
        </Button>
      </div>
    </div>
  )
}
