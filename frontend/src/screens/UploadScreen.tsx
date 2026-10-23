import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, RefObject } from 'react'
import {
  AlertCircle,
  ArrowRight,
  Camera,
  Check,
  ImagePlus,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import { ApiError, getErrorMessage, isAbortError } from '../api/client'
import { sourceImageUrl } from '../api/images'
import type { ProjectImage } from '../api/types'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { cn } from '../lib/cn'
import { formatFileSize } from '../lib/format'
import { inspectPhotoFile, PHOTO_ACCEPT } from '../lib/photoFile'
import { PROJECT_PHOTO_LIMIT, photoNumber } from '../lib/photos'
import { STEPS } from '../lib/steps'
import { useWorkspace } from '../state/useWorkspace'

type UploadPhase = 'idle' | 'reading' | 'uploading' | 'server-check'

interface UploadedPhotoInfo {
  imageId: string
  mimeLabel: string
  size: number
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-line/70 pt-3 first:border-t-0 first:pt-0 sm:border-t-0 sm:pt-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-ink-2">{value}</dd>
    </div>
  )
}

function getPhotoStatusLabel(
  phase: UploadPhase,
  hasPhoto: boolean,
): string {
  if (phase === 'reading') return 'Checking file'
  if (phase === 'uploading') return 'Uploading'
  if (phase === 'server-check') return 'Checking photo'
  return hasPhoto ? 'Photo ready' : 'No photo yet'
}

function CornerMarks() {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
    >
      <span className="absolute left-2 top-2 size-3 border-l border-t border-on-pine/80 drop-shadow-[0_0_1px_rgba(0,0,0,0.55)]" />
      <span className="absolute right-2 top-2 size-3 border-r border-t border-on-pine/80 drop-shadow-[0_0_1px_rgba(0,0,0,0.55)]" />
      <span className="absolute bottom-2 left-2 size-3 border-b border-l border-on-pine/80 drop-shadow-[0_0_1px_rgba(0,0,0,0.55)]" />
      <span className="absolute bottom-2 right-2 size-3 border-b border-r border-on-pine/80 drop-shadow-[0_0_1px_rgba(0,0,0,0.55)]" />
    </div>
  )
}

interface PhotoPlateProps {
  src: string
  alt: string
  width?: number
  height?: number
  phase: UploadPhase
  progress: number
}

function PhotoPlate({
  src,
  alt,
  width,
  height,
  phase,
  progress,
}: PhotoPlateProps) {
  const showProgress = phase === 'uploading' || phase === 'server-check'
  const checking = phase === 'server-check'

  return (
    <div className="relative mx-auto w-fit max-w-full">
      <div className="relative border border-line-strong bg-surface-2 p-1.5 shadow-sheet">
        <div className="relative overflow-hidden bg-ink/5">
          <img
            src={src}
            alt={alt}
            width={width}
            height={height}
            className="block h-auto max-h-[540px] w-auto max-w-full object-contain"
          />
          <CornerMarks />
        </div>
      </div>

      {showProgress ? (
        <div className="absolute inset-x-1.5 bottom-1.5 rounded-b-[1px] bg-ink/80 px-3 py-2.5 text-on-pine backdrop-blur-sm">
          <div className="flex items-center justify-between gap-3">
            <span
              role="status"
              aria-live="polite"
              className="text-xs font-medium"
            >
              {checking
                ? 'Checking sharpness and exposure…'
                : 'Uploading photo…'}
            </span>
            <span className="font-mono text-[11px] tabular">
              {progress}%
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Photo upload progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            className="mt-2 h-1 overflow-hidden rounded-full bg-on-pine/25"
          >
            <div
              className="h-full rounded-full bg-on-pine transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function FullQualityCard({
  image,
  file,
  sectionRef,
}: {
  image: ProjectImage
  file: UploadedPhotoInfo
  sectionRef: RefObject<HTMLElement | null>
}) {
  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-labelledby="photo-quality-heading"
      className="scroll-mt-28 rounded-[2px] border border-line bg-surface p-5 shadow-sheet"
    >
      <p className="sr-only" role="status">
        Photo accepted by the server.
      </p>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-ok-soft text-ok">
            <ShieldCheck
              className="size-4.5"
              strokeWidth={1.8}
              aria-hidden="true"
            />
          </span>
          <div>
            <h2
              id="photo-quality-heading"
              className="display text-lg font-semibold tracking-tight"
            >
              Accepted by the server.
            </h2>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-ok/25 bg-ok-soft px-2.5 py-1 text-xs font-medium text-ok">
          <Check
            className="size-3.5"
            strokeWidth={2.2}
            aria-hidden="true"
          />
          Ready
        </span>
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-3">
        <DetailRow
          label="Resolution"
          value={`${image.width} × ${image.height} px`}
        />
        <DetailRow label="File type" value={file.mimeLabel} />
        <DetailRow label="File size" value={formatFileSize(file.size)} />
      </dl>
    </section>
  )
}

function StoredPhotoCard({ image }: { image: ProjectImage }) {
  return (
    <section
      aria-labelledby="photo-stored-heading"
      className="rounded-[2px] border border-line bg-surface p-5"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-ok-soft text-ok">
          <ShieldCheck
            className="size-4.5"
            strokeWidth={1.8}
            aria-hidden="true"
          />
        </span>
        <div>
          <h2
            id="photo-stored-heading"
            className="display text-lg font-semibold tracking-tight"
          >
            Photo on file
          </h2>
        </div>
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <DetailRow
          label="Resolution"
          value={`${image.width} × ${image.height} px`}
        />
        <DetailRow label="Stored as" value="Web-ready photo" />
      </dl>
    </section>
  )
}

export function UploadScreen() {
  const {
    project,
    activeImage,
    banner,
    dismissBanner,
    navigate,
    showBanner,
    uploadProjectPhoto,
  } = useWorkspace()

  const [phase, setPhase] = useState<UploadPhase>('idle')
  const [progress, setProgress] = useState(0)
  const [clientError, setClientError] = useState<string | null>(null)
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(
    null,
  )
  const [uploadedInfo, setUploadedInfo] =
    useState<UploadedPhotoInfo | null>(null)
  const [dragging, setDragging] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const dropzoneButtonRef = useRef<HTMLButtonElement>(null)
  const qualitySectionRef = useRef<HTMLElement>(null)
  const uploadAbortRef = useRef<AbortController | null>(null)
  const localPreviewRef = useRef<string | null>(null)
  const focusPickerAfterErrorRef = useRef(false)
  const busyRef = useRef(false)
  const mountedRef = useRef(true)
  const bannerIdRef = useRef<number | null>(null)
  const uploadBannerIdRef = useRef<number | null>(null)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      busyRef.current = false
      uploadAbortRef.current?.abort()

      if (localPreviewRef.current !== null) {
        URL.revokeObjectURL(localPreviewRef.current)
        localPreviewRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    bannerIdRef.current = banner?.id ?? null
  }, [banner])

  const hasNoFocusedControl = useCallback(() => {
    const active = document.activeElement
    return (
      active === null ||
      active === document.body ||
      active === fileInputRef.current ||
      active === cameraInputRef.current
    )
  }, [])

  useEffect(() => {
    if (uploadedInfo === null) return
    if (!hasNoFocusedControl()) return
    qualitySectionRef.current?.focus()
  }, [hasNoFocusedControl, uploadedInfo])

  useEffect(() => {
    if (phase !== 'idle' || !focusPickerAfterErrorRef.current) return

    focusPickerAfterErrorRef.current = false
    if (!hasNoFocusedControl()) return
    dropzoneButtonRef.current?.focus()
  }, [hasNoFocusedControl, phase])

  const busy = phase !== 'idle'

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const clearUploadBanner = useCallback(() => {
    const uploadBannerId = uploadBannerIdRef.current
    uploadBannerIdRef.current = null

    if (
      uploadBannerId !== null &&
      bannerIdRef.current === uploadBannerId
    ) {
      dismissBanner()
    }
  }, [dismissBanner])

  const replaceLocalPreview = useCallback((file: File) => {
    const next = URL.createObjectURL(file)
    const previous = localPreviewRef.current
    localPreviewRef.current = next
    setLocalPreviewUrl(next)

    if (previous !== null) URL.revokeObjectURL(previous)
  }, [])

  const clearLocalPreview = useCallback(() => {
    const current = localPreviewRef.current
    localPreviewRef.current = null
    setLocalPreviewUrl(null)

    if (current !== null) URL.revokeObjectURL(current)
  }, [])

  const showUploadError = useCallback(
    (error: unknown) => {
      focusPickerAfterErrorRef.current = true

      if (
        error instanceof ApiError &&
        (error.code === 'PROJECT_NOT_FOUND' ||
          error.code === 'PROJECT_PHOTO_LIMIT_REACHED')
      ) {
        uploadBannerIdRef.current = showBanner({
          tone: 'error',
          title:
            error.code === 'PROJECT_NOT_FOUND'
              ? 'This project wasn’t found'
              : 'This project is full',
          message: error.message,
          actionLabel: 'Reload',
          action: () => window.location.reload(),
        })
        return
      }

      if (error instanceof ApiError && error.status === 0) {
        uploadBannerIdRef.current = showBanner({
          tone: 'error',
          title: 'We couldn’t upload the photo',
          message: error.message,
          actionLabel: 'Choose another',
          action: openFilePicker,
        })
        return
      }

      uploadBannerIdRef.current = showBanner({
        tone: 'error',
        title: 'That photo wasn’t accepted',
        message: getErrorMessage(error),
        actionLabel: 'Choose another',
        action: openFilePicker,
      })
    },
    [openFilePicker, showBanner],
  )

  const uploadSelectedPhoto = useCallback(
    async (file: File) => {
      if (busyRef.current) return

      busyRef.current = true
      setClientError(null)
      clearUploadBanner()
      setPhase('reading')

      try {
        const inspection = await inspectPhotoFile(file)
        if (!mountedRef.current) return

        if (!inspection.ok) {
          focusPickerAfterErrorRef.current = true
          setClientError(inspection.message)
          return
        }

        const controller = new AbortController()
        uploadAbortRef.current = controller
        replaceLocalPreview(file)
        setProgress(0)
        setPhase('uploading')
        setUploadedInfo(null)

        try {
          const uploaded = await uploadProjectPhoto(file, {
            signal: controller.signal,
            onProgress: (value) => {
              if (!mountedRef.current) return
              setProgress(
                Math.min(100, Math.max(0, Math.round(value * 100))),
              )
              if (value >= 1) {
                setPhase((current) =>
                  current === 'uploading' ? 'server-check' : current,
                )
              }
            },
          })

          if (!mountedRef.current) return

          setProgress(100)
          setUploadedInfo({
            imageId: uploaded.id,
            mimeLabel: inspection.photo.mimeLabel,
            size: file.size,
          })
          clearLocalPreview()
          clearUploadBanner()
        } catch (error) {
          if (!mountedRef.current || isAbortError(error)) return
          clearLocalPreview()
          setUploadedInfo(null)
          showUploadError(error)
        } finally {
          if (uploadAbortRef.current === controller) {
            uploadAbortRef.current = null
          }
        }
      } finally {
        if (mountedRef.current) {
          setPhase('idle')
          setProgress(0)
        }
        busyRef.current = false
      }
    },
    [
      clearLocalPreview,
      clearUploadBanner,
      replaceLocalPreview,
      showUploadError,
      uploadProjectPhoto,
    ],
  )

  const selectPhotoFromInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file) void uploadSelectedPhoto(file)
  }

  const acceptDroppedFiles = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    if (busyRef.current) return

    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) return
    if (files.length > 1) {
      setClientError('Choose one photo at a time.')
      return
    }

    void uploadSelectedPhoto(files[0])
  }

  const markDropTarget = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!busyRef.current) setDragging(true)
  }

  const clearDropTarget = (event: DragEvent<HTMLDivElement>) => {
    const related = event.relatedTarget
    if (related instanceof Node && event.currentTarget.contains(related)) {
      return
    }
    setDragging(false)
  }

  if (project === null) return null

  const atPhotoLimit = project.images.length >= PROJECT_PHOTO_LIMIT
  const activePhotoNumber =
    activeImage === null ? null : photoNumber(project.images, activeImage.id)
  const showFullQuality =
    activeImage !== null &&
    uploadedInfo !== null &&
    uploadedInfo.imageId === activeImage.id

  const sheetStatus = getPhotoStatusLabel(phase, activeImage !== null)

  const sheetMeta =
    activeImage !== null
      ? `${activeImage.width} × ${activeImage.height} px`
      : localPreviewUrl !== null
        ? phase === 'server-check'
          ? 'Checking photo'
          : 'Uploading'
        : '—'

  return (
    <div className="screen-enter">
      <header className="border-b border-line pb-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[11px] text-measure">
              Step 1 of {STEPS.length}
            </p>
            <h1 className="display mt-2 text-3xl font-bold tracking-[-0.035em] text-balance sm:text-4xl">
              Start with a straight-on photo.
            </h1>
          </div>
          <span className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted">
            {sheetStatus}
          </span>
        </div>
      </header>

      <div className="mt-6 max-w-5xl">
        <div className="min-w-0 space-y-5">
          <section className="overflow-hidden rounded-[2px] border border-line bg-surface shadow-sheet">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-measure">
                  Photo {activePhotoNumber ?? '01'}
                </span>
                <span
                  className="h-3 w-px bg-line"
                  aria-hidden="true"
                />
                <span className="text-xs text-muted">
                  {localPreviewUrl !== null
                    ? 'Selected photo'
                    : activeImage !== null
                      ? 'Facade view'
                      : 'No photo yet'}
                </span>
                {activeImage !== null ? (
                  <span className="rounded-full border border-ok/25 bg-ok-soft px-2 py-0.5 text-[10px] font-medium text-ok">
                    Your photo
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {activeImage !== null ? (
                  <Button
                    size="sm"
                    disabled={busy || atPhotoLimit}
                    title={
                      atPhotoLimit
                        ? `A project can hold ${PROJECT_PHOTO_LIMIT} photos.`
                        : undefined
                    }
                    onClick={openFilePicker}
                    className={cn(
                      !busy &&
                        !atPhotoLimit &&
                        'shadow-[0_4px_14px_rgba(35,88,68,0.28)] ring-2 ring-pine/20 ring-offset-1 ring-offset-surface',
                    )}
                    icon={
                      <ImagePlus
                        className="size-3.5"
                        aria-hidden="true"
                      />
                    }
                  >
                    {atPhotoLimit ? 'Photo limit' : 'Add photo'}
                  </Button>
                ) : null}
                <span className="font-mono text-[10px] text-muted">
                  {sheetMeta}
                </span>
              </div>
            </div>

            <div className="p-3 sm:p-5">
              {localPreviewUrl !== null ? (
                <PhotoPlate
                  src={localPreviewUrl}
                  alt="The facade photo you selected"
                  phase={phase}
                  progress={progress}
                />
              ) : activeImage !== null ? (
                <PhotoPlate
                  src={sourceImageUrl(activeImage.id)}
                  alt="Your facade photo"
                  width={activeImage.width}
                  height={activeImage.height}
                  phase={phase}
                  progress={progress}
                />
              ) : (
                <div
                  onDragEnter={markDropTarget}
                  onDragOver={markDropTarget}
                  onDragLeave={clearDropTarget}
                  onDrop={acceptDroppedFiles}
                  className={cn(
                    'rounded-[2px] border border-dashed p-3 transition-colors sm:p-4',
                    dragging && !busy
                      ? 'border-pine bg-pine-soft/60'
                      : 'border-line-strong bg-surface-2/30',
                  )}
                >
                  <button
                    ref={dropzoneButtonRef}
                    type="button"
                    onClick={openFilePicker}
                    disabled={busy}
                    aria-describedby="photo-requirements"
                    className="group flex w-full scroll-mt-28 flex-col items-center justify-center gap-4 rounded-[1px] px-4 py-10 text-center disabled:cursor-wait sm:py-16"
                  >
                    <span className="relative grid size-16 place-items-center rounded-full border border-line bg-surface text-pine shadow-sheet">
                      {phase === 'reading' ? (
                        <Spinner className="size-6" />
                      ) : (
                        <ImagePlus
                          className="size-7"
                          strokeWidth={1.5}
                          aria-hidden="true"
                        />
                      )}
                      <span className="absolute -bottom-1 -right-1 grid size-6 place-items-center rounded-full border border-line bg-surface text-measure">
                        <Upload
                          className="size-3"
                          strokeWidth={1.9}
                          aria-hidden="true"
                        />
                      </span>
                    </span>

                    <span className="max-w-[34ch]">
                      <span className="display block text-lg font-semibold tracking-tight text-ink">
                        {phase === 'reading'
                          ? 'Checking the photo…'
                          : dragging
                            ? 'Release to add this photo'
                            : 'Drop a facade photo here'}
                      </span>
                    </span>

                    {phase !== 'reading' ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-semibold text-ink transition-colors group-hover:border-pine group-hover:text-pine">
                        <ImagePlus
                          className="size-3.5"
                          aria-hidden="true"
                        />
                        Choose a photo
                      </span>
                    ) : null}
                  </button>

                  <div className="mt-3 sm:hidden">
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => cameraInputRef.current?.click()}
                      icon={
                        <Camera
                          className="size-4"
                          aria-hidden="true"
                        />
                      }
                      className="w-full"
                    >
                      Take a photo
                    </Button>
                  </div>

                  <p
                    id="photo-requirements"
                    className="mt-3 text-center text-xs leading-5 text-muted"
                  >
                    JPEG, PNG or WebP. Up to 10 MB. At least 640 px on
                    the long side.
                  </p>
                </div>
              )}

              {clientError !== null ? (
                <div
                  role="alert"
                  className="mt-3 flex items-start gap-3 rounded-[2px] border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm"
                >
                  <AlertCircle
                    className="mt-0.5 size-4 shrink-0 text-danger"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="font-semibold text-danger">
                      That photo can’t be used.
                    </p>
                    <p className="mt-0.5 text-ink-2">{clientError}</p>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          {activeImage !== null ? (
            showFullQuality && uploadedInfo !== null ? (
              <FullQualityCard
                image={activeImage}
                file={uploadedInfo}
                sectionRef={qualitySectionRef}
              />
            ) : (
              <StoredPhotoCard image={activeImage} />
            )
          ) : null}

          <div className="flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-end">
            <Button
              size="lg"
              disabled={activeImage === null || busy}
              onClick={() => {
                void navigate('regions')
              }}
              icon={
                <ArrowRight className="size-4" aria-hidden="true" />
              }
              className="w-full sm:w-auto"
            >
              Continue to mark regions
            </Button>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={PHOTO_ACCEPT}
        className="hidden"
        onChange={selectPhotoFromInput}
        disabled={busy}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept={PHOTO_ACCEPT}
        capture="environment"
        className="hidden"
        onChange={selectPhotoFromInput}
        disabled={busy}
      />
    </div>
  )
}
