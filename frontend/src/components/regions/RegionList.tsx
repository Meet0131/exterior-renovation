import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { ScanLine } from 'lucide-react'
import type { Material, Region } from '../../api/types'
import { cn } from '../../lib/cn'
import { computeRegionFinalMeasure } from '../../lib/geometry'
import {
  formatRegionMeasure,
  getRegionDisplayColor,
  getRegionSubtitle,
} from '../../lib/regions'

interface RegionListProps {
  regions: Region[]
  materials: Material[]
  selectedRegionId: string | null
  scaleFtPerPx: number | null
  width: number
  height: number
  onSelectRegion: (regionId: string) => void
  listRef: RefObject<HTMLElement | null>
}

export function RegionList({
  regions,
  materials,
  selectedRegionId,
  scaleFtPerPx,
  width,
  height,
  onSelectRegion,
  listRef,
}: RegionListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (selectedRegionId === null) return
    const row = scrollRef.current?.querySelector(
      `[data-region-id="${selectedRegionId}"]`,
    )
    row?.scrollIntoView({ block: 'nearest' })
  }, [selectedRegionId])

  return (
    <section
      ref={listRef}
      tabIndex={-1}
      aria-labelledby="region-list-heading"
      className="scroll-mt-40 rounded-[2px] border border-line bg-surface p-4 shadow-sheet outline-none sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2
            id="region-list-heading"
            className="display text-lg font-semibold tracking-tight"
          >
            Regions
          </h2>
          <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-muted">
            {regions.length}
          </span>
        </div>
      </div>

      {regions.length === 0 ? (
        <div className="mt-4 rounded-[2px] border border-dashed border-line-strong bg-surface-2/40 px-4 py-6 text-center">
          <span className="mx-auto grid size-9 place-items-center rounded-lg bg-pine-soft text-pine">
            <ScanLine
              className="size-4"
              strokeWidth={1.8}
              aria-hidden="true"
            />
          </span>
          <p className="mt-3 text-sm font-semibold text-ink-2">
            No regions yet.
          </p>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="mt-3 max-h-[20rem] space-y-1 overflow-y-auto overscroll-contain pr-1"
        >
          {regions.map((region) => {
            const selected = region.id === selectedRegionId
            const measure = computeRegionFinalMeasure(
              region,
              scaleFtPerPx,
              width,
              height,
            )
            const measureText = formatRegionMeasure(measure, region)
            const hasNumber =
              measure.kind === 'area' || measure.kind === 'length'

            return (
              <button
                key={region.id}
                id={`region-row-${region.id}`}
                data-region-id={region.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onSelectRegion(region.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-[2px] border px-3 py-2.5 text-left transition-colors',
                  selected
                    ? 'border-pine/30 bg-pine-soft/80'
                    : 'border-transparent hover:bg-surface-2',
                )}
              >
                <span
                  className={cn(
                    'size-2.5 shrink-0 rounded-full',
                    selected && 'ring-2 ring-pine/20 ring-offset-1',
                  )}
                  style={{
                    backgroundColor: getRegionDisplayColor(region),
                  }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block truncate text-sm font-semibold',
                      selected ? 'text-pine-ink' : 'text-ink',
                    )}
                  >
                    {region.name}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted">
                    {getRegionSubtitle(region, materials)}
                  </span>
                </span>
                <span
                  className={cn(
                    'shrink-0 whitespace-nowrap text-right font-mono text-[11px] tabular',
                    hasNumber ? 'text-ink-2' : 'text-faint',
                  )}
                >
                  {measureText}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
