import { useId, useState } from 'react'
import { ChevronDown, ChevronRight, Ruler, Trash2 } from 'lucide-react'
import type { Region, SurfaceType } from '../../api/types'
import type { SaveErrorInfo } from '../../state/WorkspaceContext'
import { Button } from '../ui/Button'
import { NumberInput } from '../ui/NumberInput'
import { Select } from '../ui/Select'
import { TextInput } from '../ui/TextInput'
import { cn } from '../../lib/cn'
import { formatMeasure, formatNumber } from '../../lib/format'
import {
  computeRegionFinalMeasure,
  computeRegionGrossAreaSqFt,
} from '../../lib/geometry'
import type { SurfaceChangeResult } from '../../lib/regions'
import {
  SURFACE_OPTIONS,
  getRegionDisplayColor,
  getRegionRoleLabel,
  getSurfaceLabel,
} from '../../lib/regions'

interface RegionInspectorProps {
  region: Region | null
  openings: Region[]
  scaleFtPerPx: number | null
  width: number
  height: number
  saveError: SaveErrorInfo | null
  surfaceNotice: string | null
  onRename: (name: string) => void
  onDeductionChange: (value: number) => void
  onManualMeasureChange: (value: number | null) => void
  onSurfaceChange: (surface: SurfaceType) => SurfaceChangeResult
  onDelete: () => void
  onSetScale: () => void
  onFlush: () => void
}

function formatInputNumber(value: number): string {
  if (!Number.isFinite(value)) return ''
  return String(Math.round(value * 10) / 10)
}

function Chip({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-line bg-surface-2/70 px-2 py-0.5 text-xs font-medium text-ink-2">
      {children}
    </span>
  )
}

export function RegionInspector({
  region,
  openings,
  scaleFtPerPx,
  width,
  height,
  saveError,
  surfaceNotice,
  onRename,
  onDeductionChange,
  onManualMeasureChange,
  onSurfaceChange,
  onDelete,
  onSetScale,
  onFlush,
}: RegionInspectorProps) {
  const fieldPrefix = useId()
  const nameId = `${fieldPrefix}-name`
  const deductionId = `${fieldPrefix}-deduction`
  const manualId = `${fieldPrefix}-manual`
  const surfaceId = `${fieldPrefix}-surface`

  const storedManual =
    region?.geometry_type === 'polygon'
      ? (region?.manual_area_sqft ?? null)
      : (region?.manual_length_ft ?? null)

  const [nameDraft, setNameDraft] = useState(region?.name ?? '')
  const [nameError, setNameError] = useState<string | null>(null)
  const [nameNotice, setNameNotice] = useState<string | null>(null)
  const [deductionDraft, setDeductionDraft] = useState(
    region === null ? '' : formatInputNumber(region.deduction_sqft),
  )
  const [deductionError, setDeductionError] = useState<string | null>(
    null,
  )
  const [manualEnabled, setManualEnabled] = useState(
    storedManual !== null,
  )
  const [manualDraft, setManualDraft] = useState(
    storedManual === null ? '' : String(storedManual),
  )
  const [manualError, setManualError] = useState<string | null>(null)
  const [surfaceError, setSurfaceError] = useState<string | null>(null)
  const [openingsExpanded, setOpeningsExpanded] = useState(false)
  const [checkedOpeningIds, setCheckedOpeningIds] = useState<string[]>(
    [],
  )
  const [deductionHelperError, setDeductionHelperError] = useState<
    string | null
  >(null)
  const [deductionHelperNotice, setDeductionHelperNotice] = useState<
    string | null
  >(null)

  if (region === null) {
    return (
      <section
        aria-labelledby="region-inspector-empty"
        className="rounded-[2px] border border-line bg-surface p-5"
      >
        <h2
          id="region-inspector-empty"
          className="display text-lg font-semibold tracking-tight"
        >
          Region details
        </h2>
      </section>
    )
  }

  const grossArea = computeRegionGrossAreaSqFt(
    region,
    scaleFtPerPx,
    width,
    height,
  )
  const measure = computeRegionFinalMeasure(
    region,
    scaleFtPerPx,
    width,
    height,
  )
  const isReference = region.region_role === 'reference'
  const isOpening = region.region_role === 'opening'
  const isPolygon = region.geometry_type === 'polygon'
  const isManual =
    (measure.kind === 'area' || measure.kind === 'length') &&
    measure.source === 'manual'
  const measureUnit = isPolygon ? 'sq ft' : 'rft'
  const manualLabel = isPolygon ? 'area' : 'length'
  const deductionIgnored = isManual && isPolygon
  const storedDeductionTooLarge =
    grossArea !== null && region.deduction_sqft > grossArea
  const manualPlaceholder =
    !isManual &&
    (measure.kind === 'area' || measure.kind === 'length')
      ? formatNumber(measure.value, 1)
      : `Enter ${manualLabel}`
  const finalValue =
    measure.kind === 'area' || measure.kind === 'length'
      ? formatNumber(measure.value, 1)
      : manualEnabled
        ? 'Enter a measure'
        : 'Not measured'
  const finalMuted =
    measure.kind === 'unmeasured' && !manualEnabled

  const openingEntries = openings.map((opening) => {
    const openingMeasure = computeRegionFinalMeasure(
      opening,
      scaleFtPerPx,
      width,
      height,
    )
    return {
      region: opening,
      area:
        openingMeasure.kind === 'area'
          ? openingMeasure.value
          : null,
      manual:
        openingMeasure.kind === 'area' &&
        openingMeasure.source === 'manual',
    }
  })
  const selectedOpeningSum = openingEntries.reduce(
    (sum, entry) =>
      checkedOpeningIds.includes(entry.region.id) &&
      entry.area !== null
        ? sum + entry.area
        : sum,
    0,
  )
  const deductionHelperDisabled = deductionIgnored
  const canApplyDeduction =
    !deductionHelperDisabled && selectedOpeningSum > 0

  const toggleOpening = (openingId: string, checked: boolean) => {
    setCheckedOpeningIds((current) =>
      checked
        ? current.includes(openingId)
          ? current
          : [...current, openingId]
        : current.filter((id) => id !== openingId),
    )
    setDeductionHelperError(null)
    setDeductionHelperNotice(null)
  }

  const recalculateDeductionTotal = () => {
    setCheckedOpeningIds((current) =>
      current.filter((id) =>
        openingEntries.some(
          (entry) => entry.region.id === id && entry.area !== null,
        ),
      ),
    )
    setDeductionHelperError(null)
    setDeductionHelperNotice(
      'The total now uses the current opening measures.',
    )
  }

  const applySelectedDeduction = () => {
    setDeductionHelperError(null)
    setDeductionHelperNotice(null)

    if (deductionHelperDisabled) {
      setDeductionHelperError(
        'Manual area wins; the deduction is ignored.',
      )
      return
    }
    if (selectedOpeningSum <= 0) {
      setDeductionHelperError('Select at least one measured opening.')
      return
    }
    if (
      grossArea !== null &&
      selectedOpeningSum > grossArea
    ) {
      setDeductionHelperError(
        'The deduction can’t be larger than the gross area. Deselect an opening.',
      )
      return
    }

    const roundedSum = Math.round(selectedOpeningSum * 10) / 10
    onDeductionChange(roundedSum)
    setDeductionDraft(formatInputNumber(roundedSum))
    setDeductionError(null)
    setDeductionHelperNotice(
      `Deduction set to ${formatMeasure(roundedSum, 'sqft')}.`,
    )
    onFlush()
  }

  const serverField = saveError?.field ?? ''
  const serverNameError = serverField.endsWith('name')
    ? (saveError?.message ?? null)
    : null
  const serverDeductionError = serverField.endsWith('deduction_sqft')
    ? (saveError?.message ?? null)
    : null
  const deductionInvalid =
    !deductionIgnored &&
    (deductionError !== null ||
      serverDeductionError !== null ||
      storedDeductionTooLarge)
  const serverManualError =
    serverField.endsWith('manual_area_sqft') ||
    serverField.endsWith('manual_length_ft')
      ? (saveError?.message ?? null)
      : null
  const generalServerError =
    saveError !== null &&
    serverNameError === null &&
    serverDeductionError === null &&
    serverManualError === null
      ? saveError.message
      : null

  const handleSurfaceChange = (nextSurface: SurfaceType) => {
    const result = onSurfaceChange(nextSurface)
    setSurfaceError(result.ok ? null : (result.message ?? null))
  }

  const handleNameChange = (value: string) => {
    setNameDraft(value)
    setNameError(null)
    setNameNotice(null)
    const trimmed = value.trim()
    if (trimmed) onRename(trimmed)
  }

  const handleNameBlur = () => {
    const trimmed = nameDraft.trim()
    if (!trimmed) {
      setNameDraft(region.name)
      setNameError(null)
      setNameNotice('A region needs a name. The previous name was kept.')
      return
    }
    setNameDraft(trimmed)
    setNameError(null)
    setNameNotice(null)
    onRename(trimmed)
    onFlush()
  }

  const handleDeductionChange = (value: string) => {
    setDeductionDraft(value)
    setDeductionError(null)

    if (value.trim() === '') return

    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDeductionError('Enter zero or a positive number.')
      return
    }
    if (grossArea !== null && parsed > grossArea) {
      setDeductionError(
        'The deduction can’t be larger than the gross area.',
      )
      return
    }

    onDeductionChange(parsed)
  }

  const handleDeductionBlur = () => {
    if (manualEnabled) return

    if (deductionDraft.trim() === '') {
      setDeductionDraft('0')
      setDeductionError(null)
      onDeductionChange(0)
      onFlush()
      return
    }

    if (deductionError === null) onFlush()
  }

  const handleManualToggle = (checked: boolean) => {
    setManualEnabled(checked)
    setManualError(null)

    if (!checked) {
      setManualDraft('')
      onManualMeasureChange(null)
      onFlush()
      return
    }

    setManualDraft('')
  }

  const handleManualChange = (value: string) => {
    setManualDraft(value)
    setManualError(null)

    if (value.trim() === '') return

    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) {
      setManualError('Enter zero or a positive number.')
      return
    }

    onManualMeasureChange(parsed)
  }

  const handleManualBlur = () => {
    if (!manualEnabled) return

    if (manualDraft.trim() === '') {
      if (storedManual !== null) {
        setManualDraft(String(storedManual))
        setManualError(null)
      } else {
        setManualError('Enter a value or turn off the override.')
      }
      return
    }

    if (manualError !== null) return

    onFlush()
  }

  return (
    <section
      aria-labelledby="region-inspector-heading"
      className="rounded-[2px] border border-line bg-surface p-4 shadow-sheet sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-1.5 size-2.5 shrink-0 rounded-full ring-2 ring-ink/5"
          style={{ backgroundColor: getRegionDisplayColor(region) }}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <label
            htmlFor={nameId}
            className="text-sm font-medium text-muted"
          >
            Region name
          </label>
          <TextInput
            id={nameId}
            value={nameDraft}
            maxLength={80}
            aria-invalid={nameError !== null || serverNameError !== null}
            onChange={(event) => handleNameChange(event.target.value)}
            onBlur={handleNameBlur}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
            className="mt-1 h-10 text-base font-semibold"
          />
          {nameError !== null || serverNameError !== null ? (
            <p role="alert" className="text-xs text-danger">
              {nameError ?? serverNameError}
            </p>
          ) : nameNotice !== null ? (
            <p className="text-xs text-muted">{nameNotice}</p>
          ) : null}
        </div>
        <h2 id="region-inspector-heading" className="sr-only">
          Region details
        </h2>
      </div>

      <div className="mt-3 grid gap-1.5 pl-[1.375rem]">
        <div className="flex flex-wrap items-center gap-1.5">
          <label
            htmlFor={surfaceId}
            className="text-sm font-medium text-muted"
          >
            Surface
          </label>
          <Chip>{getRegionRoleLabel(region)}</Chip>
          {region.surface_type === 'gate' ||
          region.surface_type === 'roof_edge' ? (
            <span className="text-[10px] text-muted">
              Reference-only in this catalog
            </span>
          ) : null}
        </div>

        <Select
          id={surfaceId}
          value={region.surface_type}
          onChange={(event) =>
            handleSurfaceChange(event.target.value as SurfaceType)
          }
          className="h-9 text-sm"
        >
          {SURFACE_OPTIONS.map((surface) => (
            <option key={surface} value={surface}>
              {getSurfaceLabel(surface)}
            </option>
          ))}
        </Select>

        {surfaceError !== null ? (
          <p role="alert" className="text-xs leading-4 text-danger">
            {surfaceError}
          </p>
        ) : surfaceNotice !== null ? (
          <p className="text-[10px] leading-4 text-measure">
            {surfaceNotice}
          </p>
        ) : null}
      </div>

      {generalServerError !== null ? (
        <p
          role="alert"
          className="mt-3 rounded-[2px] border border-danger/30 bg-danger-soft px-3 py-2 text-xs leading-5 text-danger"
        >
          {generalServerError}
        </p>
      ) : null}

      {!isReference ? (
        <div className="mt-4 border-t border-line pt-4">
          <dl className="divide-y divide-line/60">
            {isPolygon && !isOpening ? (
              <div className="flex items-baseline justify-between gap-4 py-1.5">
                <dt className="text-sm text-muted">Gross area</dt>
                <dd className="font-mono text-sm tabular text-ink-2">
                  {grossArea === null
                    ? '—'
                    : formatNumber(grossArea, 1)}
                  {grossArea !== null ? (
                    <span className="ml-1 font-sans text-xs text-muted">
                      sq ft
                    </span>
                  ) : null}
                </dd>
              </div>
            ) : null}

            {isPolygon && !isOpening ? (
              <div className="py-1.5">
                <div className="flex items-center justify-between gap-3">
                  <label
                    htmlFor={deductionId}
                    className="text-sm text-muted"
                  >
                    Deduction
                  </label>
                  <div className="relative w-36">
                    <NumberInput
                      id={deductionId}
                      value={deductionDraft}
                      min={0}
                      step="0.1"
                      inputMode="decimal"
                      disabled={deductionIgnored}
                      aria-describedby={
                        deductionIgnored ||
                        deductionInvalid ||
                        storedDeductionTooLarge
                          ? `${deductionId}-help`
                          : undefined
                      }
                      aria-invalid={deductionInvalid}
                      onChange={(event) =>
                        handleDeductionChange(event.target.value)
                      }
                      onBlur={handleDeductionBlur}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.currentTarget.blur()
                        }
                      }}
                      style={{
                        height: '1.875rem',
                        paddingRight: '2rem',
                        fontSize: '0.875rem',
                      }}
                      className="text-right"
                    />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted">
                      sq ft
                    </span>
                  </div>
                </div>
                {deductionIgnored ||
                deductionInvalid ||
                storedDeductionTooLarge ? (
                  <p
                    id={`${deductionId}-help`}
                    className={cn(
                      'mt-1 text-xs leading-4',
                      deductionInvalid ? 'text-danger' : 'text-muted',
                    )}
                    role={deductionInvalid ? 'alert' : undefined}
                  >
                    {deductionIgnored
                      ? 'Ignored while a manual area is set.'
                      : deductionError ??
                        serverDeductionError ??
                        'This deduction is larger than the gross area.'}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="flex items-baseline justify-between gap-4 py-2.5">
              <dt className="flex items-center gap-2 text-sm font-semibold text-ink-2">
                {isOpening
                  ? 'Area'
                  : isPolygon
                    ? 'Final area'
                    : 'Final length'}
                {isManual ? (
                  <span className="rounded-full border border-measure/25 bg-measure-soft px-1.5 py-0.5 text-[9px] font-semibold text-measure">
                    Manual
                  </span>
                ) : null}
              </dt>
              <dd
                className={cn(
                  'font-mono text-base font-semibold tabular',
                  finalMuted ? 'text-faint' : 'text-ink',
                )}
              >
                {finalValue}
                {finalValue !== 'Not measured' &&
                finalValue !== 'Enter a measure' ? (
                  <span className="ml-1 font-sans text-[10px] font-normal text-muted">
                    {measureUnit}
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>

          {measure.kind === 'unmeasured' && !manualEnabled ? (
            <div className="mt-1">
              <button
                type="button"
                onClick={onSetScale}
                className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-pine hover:underline"
              >
                <Ruler className="size-3.5" aria-hidden="true" />
                Set the calibration for this photo
              </button>
            </div>
          ) : null}

          <div className="mt-3">
            <label className="flex items-center gap-2 text-sm font-medium text-ink-2">
              <input
                type="checkbox"
                checked={manualEnabled}
                onChange={(event) =>
                  handleManualToggle(event.target.checked)
                }
                className="size-4 rounded border-line text-pine accent-pine"
              />
              Use a manual {manualLabel}
            </label>

            {manualEnabled ? (
              <>
                <div className="relative mt-2">
                  <NumberInput
                    id={manualId}
                    value={manualDraft}
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    placeholder={manualPlaceholder}
                    aria-label={`Manual ${manualLabel}`}
                    aria-invalid={
                      manualError !== null || serverManualError !== null
                    }
                    onChange={(event) =>
                      handleManualChange(event.target.value)
                    }
                    onBlur={handleManualBlur}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.currentTarget.blur()
                      }
                    }}
                    className="h-9 pr-12 text-right"
                  />
                  <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted">
                    {measureUnit}
                  </span>
                </div>
                {manualError !== null || serverManualError !== null ? (
                  <p role="alert" className="mt-1 text-[11px] leading-4 text-danger">
                    {manualError ?? serverManualError}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {region.region_role === 'finish' &&
      isPolygon &&
      openings.length > 0 ? (
        <div className="mt-4 border-t border-line pt-4">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() =>
                setOpeningsExpanded((expanded) => !expanded)
              }
              aria-expanded={openingsExpanded}
              aria-controls={`${fieldPrefix}-openings`}
              className="flex items-center gap-1.5 text-sm font-semibold text-ink-2"
            >
              {openingsExpanded ? (
                <ChevronDown className="size-3.5" aria-hidden="true" />
              ) : (
                <ChevronRight className="size-3.5" aria-hidden="true" />
              )}
              Deduct openings
              <span className="font-mono text-xs font-normal text-muted">
                {openings.length}
              </span>
            </button>
            {openingsExpanded ? (
              <button
                type="button"
                onClick={recalculateDeductionTotal}
                disabled={deductionHelperDisabled}
                className="text-xs font-semibold text-pine hover:underline disabled:cursor-not-allowed disabled:text-faint disabled:no-underline"
              >
                Recalculate
              </button>
            ) : null}
          </div>

          {openingsExpanded ? (
          <div id={`${fieldPrefix}-openings`}>
          {deductionIgnored ? (
            <p className="mt-2 rounded-[2px] border border-amber/30 bg-amber-soft/70 px-2.5 py-1.5 text-[10px] leading-4 text-ink-2">
              Manual area wins; the deduction is ignored.
            </p>
          ) : null}

          <ul className="mt-2 space-y-1.5">
            {openingEntries.map((entry) => {
              const disabled =
                deductionHelperDisabled || entry.area === null
              const checked = checkedOpeningIds.includes(
                entry.region.id,
              )

              return (
                <li key={entry.region.id}>
                  <label
                    className={cn(
                      'flex items-center gap-2 rounded-[2px] border px-2.5 py-2 text-xs',
                      disabled
                        ? 'border-line/70 bg-surface-2/25 text-muted'
                        : 'border-line bg-surface-2/40 text-ink-2',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={(event) =>
                        toggleOpening(
                          entry.region.id,
                          event.target.checked,
                        )
                      }
                      className="size-4 shrink-0 rounded border-line text-pine accent-pine disabled:opacity-50"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {entry.region.name}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] tabular">
                      {entry.area === null
                        ? 'Not measured'
                        : `${formatMeasure(entry.area, 'sqft')}${entry.manual ? ' · manual' : ''}`}
                    </span>
                  </label>
                  {entry.area === null ? (
                    <p className="mt-0.5 pl-6 text-[10px] leading-4 text-muted">
                      Set the calibration or measure this opening first.
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] text-muted">
              Selected{' '}
              <span className="font-mono text-[11px] text-ink-2">
                {formatMeasure(selectedOpeningSum, 'sqft')}
              </span>
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={!canApplyDeduction}
              onClick={applySelectedDeduction}
              className="h-8 px-2.5 text-[11px]"
            >
              Use selected as deduction
            </Button>
          </div>

          {deductionHelperError !== null ? (
            <p role="alert" className="mt-2 text-[10px] leading-4 text-danger">
              {deductionHelperError}
            </p>
          ) : deductionHelperNotice !== null ? (
            <p className="mt-2 text-[10px] leading-4 text-measure">
              {deductionHelperNotice}
            </p>
          ) : null}
          </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex justify-end border-t border-line pt-3">
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-sm font-semibold text-danger transition-colors hover:bg-danger-soft"
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          Delete region
        </button>
      </div>
    </section>
  )
}
