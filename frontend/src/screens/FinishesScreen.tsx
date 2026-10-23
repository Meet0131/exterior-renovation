import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Paintbrush,
} from 'lucide-react'
import { ApiError, getErrorMessage, isAbortError } from '../api/client'
import { getImageEstimate } from '../api/estimate'
import type {
  Material,
  Region,
  RegionPatchPayload,
} from '../api/types'
import { FinishPanel } from '../components/finishes/FinishPanel'
import type { EstimateChipState } from '../components/finishes/FinishPanel'
import { LivePreview } from '../components/finishes/LivePreview'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { cn } from '../lib/cn'
import { colorsMatch } from '../lib/colors'
import { computeScaleFtPerPx } from '../lib/geometry'
import { STEPS } from '../lib/steps'
import { useWorkspace } from '../state/useWorkspace'

export function FinishesScreen() {
  const {
    project,
    activeImage,
    calibration,
    materials,
    materialsLoading,
    regions,
    selectedRegionId,
    saveState,
    selectRegion,
    updateRegion,
    reloadMaterials,
    navigate,
    continueToEstimate,
    finalizing,
  } = useWorkspace()

  const [estimate, setEstimate] = useState<EstimateChipState>({
    status: 'idle',
  })
  const estimateRequestRef = useRef(0)

  const finishRegions = regions.filter(
    (region) => region.region_role === 'finish',
  )
  const unassigned = finishRegions.filter(
    (region) => region.material_id === null,
  )
  const assignedCount = finishRegions.length - unassigned.length
  const finishCount = finishRegions.length
  const scaleFtPerPx =
    activeImage === null
      ? null
      : computeScaleFtPerPx(
          calibration,
          activeImage.width,
          activeImage.height,
        )

  useEffect(() => {
    const finishes = regions.filter(
      (region) => region.region_role === 'finish',
    )
    if (finishes.length === 0) return
    if (
      selectedRegionId !== null &&
      finishes.some((region) => region.id === selectedRegionId)
    ) {
      return
    }
    const first = finishes[0]
    if (first !== undefined) selectRegion(first.id)
  }, [regions, selectRegion, selectedRegionId])

  useEffect(() => {
    if (activeImage === null || finishCount === 0) {
      estimateRequestRef.current += 1
      return
    }
    if (saveState === 'saving') return

    const image = activeImage
    estimateRequestRef.current += 1
    const requestId = estimateRequestRef.current
    let controller: AbortController | null = null

    const timer = window.setTimeout(() => {
      controller = new AbortController()
      setEstimate((previous) =>
        previous.status === 'ready'
          ? previous
          : { status: 'loading' },
      )

      getImageEstimate(image.id, controller.signal)
        .then((result) => {
          if (estimateRequestRef.current !== requestId) return
          setEstimate({ status: 'ready', total: result.grand_total })
        })
        .catch((error) => {
          if (
            isAbortError(error) ||
            estimateRequestRef.current !== requestId
          ) {
            return
          }

          if (error instanceof ApiError && error.status === 422) {
            setEstimate({
              status:
                error.code === 'UNASSIGNED_FINISH'
                  ? 'unassigned'
                  : 'error',
              message: error.message,
            })
            return
          }

          setEstimate({
            status: 'error',
            message: getErrorMessage(error),
          })
        })
    }, 450)

    return () => {
      window.clearTimeout(timer)
      controller?.abort()
    }
  }, [activeImage, finishCount, regions, saveState])

  const handleSetMaterial = useCallback(
    (region: Region, material: Material) => {
      const colorValid =
        region.color_hex !== null &&
        material.colors.some((color) =>
          colorsMatch(color, region.color_hex),
        )
      if (region.material_id === material.id && colorValid) return

      const patch: RegionPatchPayload = {
        material_id: material.id,
        color_hex: colorValid
          ? region.color_hex
          : (material.colors[0] ?? null),
      }
      if (region.material_id !== material.id) {
        patch.material_rate_override = null
        patch.labor_rate_override = null
      }
      updateRegion(region.id, patch)
    },
    [updateRegion],
  )

  const handleSetColor = useCallback(
    (region: Region, color: string) => {
      if (colorsMatch(region.color_hex, color)) return
      updateRegion(region.id, { color_hex: color })
    },
    [updateRegion],
  )

  const handleClearFinish = useCallback(
    (region: Region) => {
      updateRegion(region.id, {
        material_id: null,
        color_hex: null,
        material_rate_override: null,
        labor_rate_override: null,
      })
    },
    [updateRegion],
  )

  if (project === null) return null

  if (activeImage === null) {
    return (
      <div className="screen-enter">
        <EmptyState
          icon={<Paintbrush className="size-5" strokeWidth={1.8} />}
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

  if (finishRegions.length === 0) {
    return (
      <div className="screen-enter">
        <EmptyState
          icon={<Paintbrush className="size-5" strokeWidth={1.8} />}
          title="No surfaces to choose materials for yet."
          action={
            <Button
              onClick={() => {
                void navigate('regions')
              }}
            >
              Back to regions
            </Button>
          }
        />
      </div>
    )
  }

  const selected =
    finishRegions.find(
      (region) => region.id === selectedRegionId,
    ) ?? finishRegions[0]

  return (
    <div className="screen-enter">
      <header className="border-b border-line pb-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[11px] text-measure">
              Step 3 of {STEPS.length}
            </p>
            <h1 className="display mt-2 text-3xl font-bold tracking-[-0.035em] text-balance sm:text-4xl">
              Choose materials and colours that suit the house.
            </h1>
          </div>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium',
              unassigned.length === 0
                ? 'border-ok/25 bg-ok-soft text-ok'
                : 'border-amber/30 bg-amber-soft text-amber',
            )}
          >
            <span
              className={cn(
                'size-1.5 rounded-full',
                unassigned.length === 0 ? 'bg-ok' : 'bg-amber',
              )}
              aria-hidden="true"
            />
            {assignedCount} of {finishRegions.length} assigned
          </span>
        </div>
      </header>

      <section
        aria-live="polite"
        className={cn(
          'mt-5 flex items-start gap-3 rounded-[2px] border px-4 py-3',
          unassigned.length === 0
            ? 'border-ok/25 bg-ok-soft/50'
            : 'border-amber/30 bg-amber-soft/55',
        )}
      >
        <span
          className={cn(
            'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full',
            unassigned.length === 0
              ? 'bg-ok-soft text-ok'
              : 'bg-amber-soft text-amber',
          )}
          aria-hidden="true"
        >
          {unassigned.length === 0 ? (
            <CheckCircle2 className="size-3.5" />
          ) : (
            <AlertTriangle className="size-3.5" />
          )}
        </span>
        <div className="min-w-0">
          <p
            className={cn(
              'text-xs font-semibold',
              unassigned.length === 0 ? 'text-ink-2' : 'text-amber',
            )}
          >
            {unassigned.length === 0
              ? 'Every marked surface has a material.'
              : `${unassigned.length} ${
                  unassigned.length === 1 ? 'surface still needs' : 'surfaces still need'
                } a material.`}
          </p>
          {unassigned.length > 0 ? (
            <p className="mt-0.5 text-[11px] leading-4 text-muted">
              {unassigned.map((region) => region.name).join(' · ')}
            </p>
          ) : null}
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.12fr)_minmax(22rem,0.88fr)] lg:gap-8">
        <div className="min-w-0 lg:sticky lg:top-28 lg:self-start">
          <LivePreview
            image={activeImage}
            regions={regions}
            materials={materials}
            selectedRegionId={selected.id}
            scaleFtPerPx={scaleFtPerPx}
          />
        </div>

        <aside className="min-w-0">
          <FinishPanel
            regions={finishRegions}
            materials={materials}
            materialsLoading={materialsLoading}
            selectedRegionId={selected.id}
            scaleFtPerPx={scaleFtPerPx}
            width={activeImage.width}
            height={activeImage.height}
            estimate={estimate}
            onSelectRegion={selectRegion}
            onSetMaterial={handleSetMaterial}
            onSetColor={handleSetColor}
            onClearFinish={handleClearFinish}
            onReloadMaterials={() => {
              void reloadMaterials()
            }}
          />
        </aside>
      </div>

      <div className="mt-6 flex flex-col gap-4 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <Button
          variant="ghost"
          onClick={() => {
            void navigate('regions')
          }}
          icon={<ArrowLeft className="size-4" aria-hidden="true" />}
        >
          Back to regions
        </Button>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <Button
            className="shrink-0"
            loading={finalizing}
            onClick={() => {
              void continueToEstimate()
            }}
            icon={<ArrowRight className="size-4" aria-hidden="true" />}
          >
            Continue to estimate
          </Button>
        </div>
      </div>
    </div>
  )
}
