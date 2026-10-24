import { useCallback, useEffect } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Paintbrush,
} from 'lucide-react'
import type {
  Material,
  Region,
  RegionPatchPayload,
} from '../api/types'
import { FinishPanel } from '../components/finishes/FinishPanel'
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
    selectRegion,
    updateRegion,
    reloadMaterials,
    navigate,
    continueToEstimate,
  } = useWorkspace()

  const finishRegions = regions.filter(
    (region) => region.region_role === 'finish',
  )
  const assignedCount = finishRegions.filter(
    (region) => region.material_id !== null,
  ).length
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
              assignedCount === finishRegions.length
                ? 'border-ok/25 bg-ok-soft text-ok'
                : 'border-amber/30 bg-amber-soft text-amber',
            )}
          >
            <span
              className={cn(
                'size-1.5 rounded-full',
                assignedCount === finishRegions.length
                  ? 'bg-ok'
                  : 'bg-amber',
              )}
              aria-hidden="true"
            />
            {assignedCount} of {finishRegions.length} assigned
          </span>
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.46fr)] lg:gap-8">
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
