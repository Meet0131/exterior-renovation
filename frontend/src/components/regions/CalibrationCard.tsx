import { useEffect, useId, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Ruler,
} from 'lucide-react'
import type { Calibration, GeometryPoint } from '../../api/types'
import type { SaveErrorInfo } from '../../state/WorkspaceContext'
import { Button } from '../ui/Button'
import { NumberInput } from '../ui/NumberInput'
import { computePointDistance } from '../../lib/geometry'
import { computeScaleDisplay } from '../../lib/regions'

interface CalibrationCardProps {
  calibration: Calibration | null
  scaleFtPerPx: number | null
  width: number
  height: number
  draftPoints: GeometryPoint[] | null
  error: SaveErrorInfo | null
  onBegin: () => void
  onCancel: () => void
  onApplyDraft: (lengthFt: number) => void
  onLengthChange: (lengthFt: number) => void
  onClear: () => void
  onFlush: () => void
}

export function CalibrationCard({
  calibration,
  scaleFtPerPx,
  width,
  height,
  draftPoints,
  error,
  onBegin,
  onCancel,
  onApplyDraft,
  onLengthChange,
  onClear,
  onFlush,
}: CalibrationCardProps) {
  const fieldPrefix = useId()
  const lengthId = `${fieldPrefix}-calibration-length`
  const draftLengthId = `${fieldPrefix}-draft-length`
  const bodyId = `${fieldPrefix}-calibration-body`
  const cardRef = useRef<HTMLElement>(null)
  const draftInputRef = useRef<HTMLInputElement>(null)

  const [lengthDraft, setLengthDraft] = useState<string | null>(null)
  const [lengthError, setLengthError] = useState<string | null>(null)
  const [draftLength, setDraftLength] = useState('')
  const [draftError, setDraftError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const wasCalibratedRef = useRef(calibration !== null)

  useEffect(() => {
    if (draftPoints?.length !== 2) return

    const timer = window.setTimeout(() => {
      draftInputRef.current?.focus()
      draftInputRef.current?.select()
      cardRef.current?.scrollIntoView({
        behavior: window.matchMedia(
          '(prefers-reduced-motion: reduce)',
        ).matches
          ? 'auto'
          : 'smooth',
        block: 'nearest',
      })
    }, 0)

    return () => window.clearTimeout(timer)
  }, [draftPoints?.length])

  useEffect(() => {
    if (wasCalibratedRef.current && calibration === null) {
      const timer = window.setTimeout(() => {
        cardRef.current?.focus()
      }, 0)
      wasCalibratedRef.current = false
      return () => window.clearTimeout(timer)
    }

    wasCalibratedRef.current = calibration !== null
  }, [calibration])

  const scaleDisplay = computeScaleDisplay(scaleFtPerPx)
  const displayedLength =
    lengthDraft ??
    (calibration === null ? '' : String(calibration.length_ft))
  const drawing = draftPoints !== null
  const pointCount = draftPoints?.length ?? 0
  const isExpanded = drawing || expanded
  const draftLengthValue = Number(draftLength)
  const draftPixelDistance =
    draftPoints !== null && draftPoints.length === 2
      ? computePointDistance(
          draftPoints[0],
          draftPoints[1],
          width,
          height,
        )
      : null

  const handleBegin = () => {
    setDraftError(null)
    setLengthError(null)
    setLengthDraft(null)
    setDraftLength(
      calibration === null ? '' : String(calibration.length_ft),
    )
    onBegin()
  }

  const handleCancel = () => {
    setDraftError(null)
    setLengthDraft(null)
    onCancel()
    window.setTimeout(() => {
      cardRef.current?.focus()
    }, 0)
  }

  const handleDraftApply = () => {
    if (draftPoints === null || draftPoints.length !== 2) return

    if (!Number.isFinite(draftLengthValue) || draftLengthValue <= 0) {
      setDraftError('Enter a length greater than 0.')
      return
    }

    if (draftPixelDistance === null || draftPixelDistance < 2) {
      setDraftError('Move the two points further apart.')
      return
    }

    setDraftError(null)
    onApplyDraft(draftLengthValue)
    window.setTimeout(() => {
      cardRef.current?.focus()
    }, 0)
  }

  const handleLengthChange = (value: string) => {
    setLengthDraft(value)
    setLengthError(null)

    if (value.trim() === '') return

    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setLengthError('Enter a length greater than 0.')
      return
    }

    onLengthChange(parsed)
  }

  const handleLengthBlur = () => {
    const parsed = Number(displayedLength)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setLengthError('Enter a length greater than 0.')
      setLengthDraft(null)
      return
    }

    setLengthError(null)
    onLengthChange(parsed)
    onFlush()
    setLengthDraft(null)
  }

  const handleLengthApply = () => {
    const parsed = Number(displayedLength)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setLengthError('Enter a length greater than 0.')
      return
    }

    setLengthError(null)
    onLengthChange(parsed)
    onFlush()
    setLengthDraft(null)
  }

  const serverError = error?.message ?? null
  const summary = drawing
    ? `${pointCount} of 2 points placed`
    : calibration === null
      ? 'Not set'
      : scaleDisplay === null
        ? 'Reference points are too close'
        : `1 ft = ${scaleDisplay.pixelsPerFoot} px`

  return (
    <section
      ref={cardRef}
      tabIndex={-1}
      aria-labelledby="calibration-heading"
      className="scroll-mt-40 rounded-[2px] border border-line border-l-2 border-l-measure bg-surface p-3 shadow-sheet outline-none sm:p-4"
    >
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={isExpanded}
        aria-controls={bodyId}
        className="flex w-full items-center gap-2.5 text-left"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-measure-soft text-measure">
          <Ruler
            className="size-4"
            strokeWidth={1.8}
            aria-hidden="true"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span
            id="calibration-heading"
            className="display block text-base font-semibold tracking-tight"
          >
            {drawing ? 'Draw the scale line' : 'Scale'}
          </span>
          <span className="mt-0.5 block text-xs text-muted">
            {summary}
          </span>
        </span>
        {isExpanded ? (
          <ChevronDown
            className="size-4 shrink-0 text-muted"
            aria-hidden="true"
          />
        ) : (
          <ChevronRight
            className="size-4 shrink-0 text-muted"
            aria-hidden="true"
          />
        )}
      </button>

      {isExpanded ? (
        <div id={bodyId} className="mt-3">
          {drawing ? (
            <div>
              {pointCount === 2 ? (
                <div>
                  <label
                    htmlFor={draftLengthId}
                    className="text-sm font-medium text-ink-2"
                  >
                    Real length (ft)
                  </label>
                  <div className="relative mt-1">
                    <NumberInput
                      ref={draftInputRef}
                      id={draftLengthId}
                      value={draftLength}
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      placeholder="e.g. 7"
                      aria-invalid={
                        draftError !== null || serverError !== null
                      }
                      onChange={(event) => {
                        setDraftLength(event.target.value)
                        setDraftError(null)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          handleDraftApply()
                        }
                      }}
                      className="h-9 pr-10"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted">
                      ft
                    </span>
                  </div>
                </div>
              ) : null}

              {draftError !== null || serverError !== null ? (
                <p role="alert" className="mt-2 text-xs text-danger">
                  {draftError ?? serverError}
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                {pointCount === 2 ? (
                  <Button size="sm" onClick={handleDraftApply}>
                    Apply scale
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleCancel}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : calibration === null ? (
            <Button
              size="sm"
              onClick={handleBegin}
              icon={<Ruler className="size-3.5" aria-hidden="true" />}
            >
              Draw the scale line
            </Button>
          ) : (
            <div>
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <label
                    htmlFor={lengthId}
                    className="text-sm font-medium text-ink-2"
                  >
                    Reference length
                  </label>
                  <div className="relative mt-1">
                    <NumberInput
                      id={lengthId}
                      value={displayedLength}
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      aria-invalid={
                        lengthError !== null || serverError !== null
                      }
                      onFocus={() =>
                        setLengthDraft(displayedLength)
                      }
                      onChange={(event) =>
                        handleLengthChange(event.target.value)
                      }
                      onBlur={handleLengthBlur}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          event.currentTarget.blur()
                        }
                      }}
                      className="h-9 pr-10"
                    />
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted">
                      ft
                    </span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleLengthApply}
                >
                  Apply
                </Button>
              </div>

              {lengthError !== null || serverError !== null ? (
                <p
                  role="alert"
                  className="mt-1 text-xs leading-4 text-danger"
                >
                  {lengthError ?? serverError}
                </p>
              ) : null}

              <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-xs text-muted">
                {scaleDisplay === null ? (
                  <span className="text-danger">
                    The reference points are too close. Redraw the
                    line.
                  </span>
                ) : (
                  <>
                    <span>1 px = {scaleDisplay.feetPerPixel} ft</span>
                    <span
                      className="h-2.5 w-px bg-line"
                      aria-hidden="true"
                    />
                    <span>1 ft = {scaleDisplay.pixelsPerFoot} px</span>
                  </>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleBegin}
                >
                  Redraw line
                </Button>
                <button
                  type="button"
                  onClick={onClear}
                  className="inline-flex items-center rounded-md px-2 py-1.5 text-sm font-semibold text-danger transition-colors hover:bg-danger-soft"
                >
                  Clear scale
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}
