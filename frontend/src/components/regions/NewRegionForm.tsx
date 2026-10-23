import { useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import type {
  GeometryPoint,
  GeometryType,
  Region,
  SurfaceType,
} from '../../api/types'
import type { NewRegionInput } from '../../state/WorkspaceContext'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'
import { TextInput } from '../ui/TextInput'
import { formatMeasure } from '../../lib/format'
import {
  computePolygonAreaSqFt,
  computePolylineLengthFt,
} from '../../lib/geometry'
import {
  SURFACE_OPTIONS,
  getDefaultRegionName,
  getSurfaceGeometryType,
  getSurfaceLabel,
  getSurfaceRole,
} from '../../lib/regions'

interface NewRegionFormProps {
  geometryType: GeometryType
  points: GeometryPoint[]
  regions: Region[]
  scaleFtPerPx: number | null
  width: number
  height: number
  initialSurface?: SurfaceType
  initialName?: string
  shapeProblem?: string | null
  heading?: string
  onAdd: (input: NewRegionInput) => void
  onCancel: () => void
}

export function NewRegionForm({
  geometryType,
  points,
  regions,
  scaleFtPerPx,
  width,
  height,
  initialSurface: preferredSurface,
  initialName,
  shapeProblem = null,
  heading = 'Name this region',
  onAdd,
  onCancel,
}: NewRegionFormProps) {
  const initialSurface: SurfaceType =
    preferredSurface ?? (geometryType === 'line' ? 'railing' : 'wall')
  const containerRef = useRef<HTMLElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const [surface, setSurface] = useState<SurfaceType>(initialSurface)
  const [name, setName] = useState(() =>
    initialName?.trim()
      ? initialName
      : getDefaultRegionName(initialSurface, regions),
  )
  const [nameTouched, setNameTouched] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      containerRef.current?.scrollIntoView({
        behavior: window.matchMedia(
          '(prefers-reduced-motion: reduce)',
        ).matches
          ? 'auto'
          : 'smooth',
        block: 'center',
      })
      nameRef.current?.focus({ preventScroll: true })
    }, 0)

    return () => window.clearTimeout(timer)
  }, [])

  const role = getSurfaceRole(surface)
  const expectedGeometry = getSurfaceGeometryType(surface)
  const geometryProblem =
    expectedGeometry === geometryType
      ? null
      : expectedGeometry === 'line'
        ? 'Railing needs a line; draw a new railing region.'
        : 'This is a line. Railing is the only line surface. Draw a new region for another surface.'

  const measure =
    geometryType === 'polygon'
      ? computePolygonAreaSqFt(
          points,
          width,
          height,
          scaleFtPerPx,
        )
      : computePolylineLengthFt(
          points,
          width,
          height,
          scaleFtPerPx,
        )
  const measureText =
    measure === null
      ? 'Set a scale to see the live measure.'
      : `${formatMeasure(measure, geometryType === 'polygon' ? 'sqft' : 'rft')} once added`

  const handleSurfaceChange = (nextSurface: SurfaceType) => {
    setSurface(nextSurface)
    setNameError(null)
    if (!nameTouched) {
      setName(getDefaultRegionName(nextSurface, regions))
    }
  }

  const handleAdd = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError('A region needs a name.')
      return
    }
    if (geometryProblem !== null || shapeProblem !== null) return

    onAdd({
      name: trimmed,
      geometry_type: geometryType,
      geometry_json: points,
      surface_type: surface,
      region_role: role,
    })
  }

  return (
    <section
      ref={containerRef}
      aria-labelledby="new-region-heading"
      className="scroll-mt-40 rounded-[2px] border border-pine/30 bg-surface p-4 shadow-sheet sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-measure">
            Shape closed
          </p>
          <h2
            id="new-region-heading"
            className="display mt-1 text-lg font-semibold tracking-tight"
          >
            {heading}
          </h2>
        </div>
        <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[10px] text-muted">
          {points.length}{' '}
          {points.length === 1 ? 'point' : 'points'}
        </span>
      </div>

      <div className="mt-4 grid gap-3">
        <label className="grid gap-1">
          <span className="text-xs font-medium text-ink-2">Name</span>
          <TextInput
            ref={nameRef}
            value={name}
            maxLength={80}
            aria-invalid={nameError !== null}
            onChange={(event) => {
              setName(event.target.value)
              setNameTouched(true)
              setNameError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                handleAdd()
              }
            }}
          />
          {nameError !== null ? (
            <span role="alert" className="text-xs text-danger">
              {nameError}
            </span>
          ) : null}
        </label>

        <label className="grid gap-1">
          <span className="text-xs font-medium text-ink-2">Surface</span>
          <Select
            value={surface}
            onChange={(event) =>
              handleSurfaceChange(event.target.value as SurfaceType)
            }
            className="h-10"
          >
            {SURFACE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {getSurfaceLabel(option)}
              </option>
            ))}
          </Select>
        </label>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full border border-line bg-surface-2/70 px-2 py-0.5 text-[10px] font-medium text-ink-2">
            {role === 'finish'
              ? 'Finish'
              : role === 'opening'
                ? 'Opening'
                : 'Reference'}
          </span>
        </div>
      </div>

      {shapeProblem !== null || geometryProblem !== null ? (
        <p
          role="alert"
          className="mt-3 rounded-[2px] border border-danger/30 bg-danger-soft px-3 py-2 text-xs leading-5 text-danger"
        >
          {shapeProblem ?? geometryProblem}
        </p>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-3 rounded-[2px] border border-line bg-surface-2/40 px-3 py-2">
        <span className="text-[10px] text-muted">Live measure</span>
        <span className="text-right font-mono text-[11px] tabular text-ink-2">
          {measureText}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={handleAdd}
          disabled={
            name.trim() === '' ||
            geometryProblem !== null ||
            shapeProblem !== null
          }
          icon={<Check className="size-3.5" aria-hidden="true" />}
        >
          Add region
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          icon={<X className="size-3.5" aria-hidden="true" />}
        >
          Cancel
        </Button>
      </div>
    </section>
  )
}
