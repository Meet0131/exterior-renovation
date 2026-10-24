import type { CSSProperties } from 'react'
import {
  AlertTriangle,
  Check,
  RefreshCw,
  X,
} from 'lucide-react'
import type { Material, Region, SurfaceType } from '../../api/types'
import { Button } from '../ui/Button'
import { cn } from '../../lib/cn'
import { colorsMatch } from '../../lib/colors'
import { formatMoney, formatUnit } from '../../lib/format'
import { computeRegionFinalMeasure } from '../../lib/geometry'
import { getMaterialNote } from '../../lib/materialNotes'
import {
  findRegionMaterial,
  formatRegionMeasure,
  getSurfaceLabel,
} from '../../lib/regions'

interface FinishPanelProps {
  regions: Region[]
  materials: Material[]
  materialsLoading: boolean
  selectedRegionId: string | null
  scaleFtPerPx: number | null
  width: number
  height: number
  onSelectRegion: (regionId: string) => void
  onSetMaterial: (region: Region, material: Material) => void
  onSetColor: (region: Region, color: string) => void
  onClearFinish: (region: Region) => void
  onReloadMaterials: () => void
}

const SURFACE_ORDER: SurfaceType[] = [
  'wall',
  'pillar',
  'parapet',
  'trim',
  'balcony_slab',
  'railing',
]

function surfaceRank(surface: SurfaceType): number {
  const index = SURFACE_ORDER.indexOf(surface)
  return index === -1 ? SURFACE_ORDER.length : index
}

function groupFinishRegions(
  regions: Region[],
): Array<{ surface: SurfaceType; regions: Region[] }> {
  const bySurface = new Map<SurfaceType, Region[]>()
  for (const region of regions) {
    const existing = bySurface.get(region.surface_type)
    if (existing === undefined) {
      bySurface.set(region.surface_type, [region])
    } else {
      existing.push(region)
    }
  }

  return [...bySurface.entries()]
    .sort(
      (first, second) =>
        surfaceRank(first[0]) - surfaceRank(second[0]),
    )
    .map(([surface, groupRegions]) => ({
      surface,
      regions: groupRegions,
    }))
}

function materialSwatchStyle(
  material: Material,
  color: string,
): CSSProperties {
  const style: CSSProperties = { backgroundColor: color }

  if (material.texture === 'tile') {
    style.backgroundImage =
      'linear-gradient(to right, rgba(255,255,255,.55) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.55) 1px, transparent 1px)'
    style.backgroundSize = '7px 7px'
  } else if (material.texture === 'stone') {
    style.backgroundImage =
      'radial-gradient(circle at 30% 30%, rgba(255,255,255,.4), transparent 55%), radial-gradient(circle at 72% 70%, rgba(0,0,0,.22), transparent 48%)'
  } else if (material.texture === 'wood') {
    style.backgroundImage =
      'repeating-linear-gradient(90deg, rgba(0,0,0,.18) 0 1px, transparent 1px 6px)'
  } else if (material.texture === 'metal') {
    style.backgroundImage =
      'linear-gradient(135deg, rgba(255,255,255,.5), transparent 42%, rgba(0,0,0,.22))'
  } else if (material.texture === 'glass') {
    style.backgroundImage =
      'linear-gradient(135deg, rgba(255,255,255,.7), rgba(255,255,255,.12) 46%, rgba(255,255,255,.5))'
  } else if (material.texture === 'texture') {
    style.backgroundImage =
      'radial-gradient(circle at 38% 38%, rgba(255,255,255,.32), transparent 62%)'
  }

  return style
}

export function FinishPanel({
  regions,
  materials,
  materialsLoading,
  selectedRegionId,
  scaleFtPerPx,
  width,
  height,
  onSelectRegion,
  onSetMaterial,
  onSetColor,
  onClearFinish,
  onReloadMaterials,
}: FinishPanelProps) {
  const groups = groupFinishRegions(regions)
  const selected =
    regions.find((region) => region.id === selectedRegionId) ??
    regions[0] ??
    null
  const selectedMaterial =
    selected === null ? null : findRegionMaterial(selected, materials)
  const selectedMeasure =
    selected === null
      ? null
      : computeRegionFinalMeasure(
          selected,
          scaleFtPerPx,
          width,
          height,
        )
  const applicableMaterials =
    selected === null
      ? []
      : materials.filter((material) =>
          material.surfaces.includes(selected.surface_type),
        )
  const staleMaterial =
    selected !== null &&
    selected.material_id !== null &&
    (selectedMaterial === null ||
      !selectedMaterial.surfaces.includes(selected.surface_type))
  const canClear =
    selected !== null &&
    (selected.material_id !== null ||
      selected.color_hex !== null ||
      selected.material_rate_override !== null ||
      selected.labor_rate_override !== null)

  return (
    <section
      aria-labelledby="materials-panel-heading"
      className="rounded-[2px] border border-line bg-surface p-4 shadow-sheet sm:p-5"
    >
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-measure">
          Materials
        </p>
        <h2
          id="materials-panel-heading"
          className="display mt-1 text-xl font-semibold tracking-tight"
        >
          Choose materials and colours
        </h2>
      </div>

      <div className="mt-4 max-h-[20rem] space-y-3 overflow-y-auto overscroll-contain pr-1">
        {groups.map((group) => (
          <div key={group.surface}>
            <div className="flex items-baseline justify-between gap-3 border-b border-line/70 pb-1">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
                {getSurfaceLabel(group.surface)}
              </h3>
              <span className="font-mono text-[9px] text-faint">
                {group.regions.length}
              </span>
            </div>
            <ul className="mt-1.5 space-y-1.5">
              {group.regions.map((region) => {
                const material = findRegionMaterial(region, materials)
                const measure = computeRegionFinalMeasure(
                  region,
                  scaleFtPerPx,
                  width,
                  height,
                )
                const active = selected?.id === region.id
                const unassigned = region.material_id === null
                const unavailable =
                  region.material_id !== null && material === null
                const color =
                  region.color_hex ??
                  (material?.colors[0] ?? null)

                return (
                  <li key={region.id}>
                    <button
                      type="button"
                      onClick={() => onSelectRegion(region.id)}
                      aria-pressed={active}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-[2px] border px-2.5 py-2 text-left transition-colors',
                        active
                          ? 'border-pine bg-pine-soft/55'
                          : 'border-line bg-surface-2/35 hover:border-line-strong hover:bg-surface-2/70',
                      )}
                    >
                      <span
                        className={cn(
                          'size-3 shrink-0 rounded-full border',
                          color === null
                            ? 'border-line-strong bg-surface-3'
                            : 'border-ink/15',
                        )}
                        style={
                          color === null
                            ? undefined
                            : { backgroundColor: color }
                        }
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-xs font-semibold text-ink">
                            {region.name}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-muted">
                            {formatRegionMeasure(measure, region)}
                          </span>
                        </span>
                        <span
                          className={cn(
                            'mt-0.5 block truncate text-[10px]',
                            unassigned || unavailable
                              ? 'font-medium text-amber'
                              : 'text-muted',
                          )}
                        >
                          {unassigned
                            ? 'Unassigned — choose a material'
                            : unavailable
                              ? 'This material doesn’t fit this surface'
                              : (material?.name ?? 'Material unavailable')}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      {selected !== null ? (
        <div className="mt-5 border-t border-line pt-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-measure">
                Editing
              </p>
              <h3 className="display mt-0.5 truncate text-base font-semibold tracking-tight">
                {selected.name}
              </h3>
              <p className="mt-0.5 text-[10px] text-muted">
                {getSurfaceLabel(selected.surface_type)} ·{' '}
                {selectedMeasure === null
                  ? 'No measure'
                  : formatRegionMeasure(selectedMeasure, selected)}
              </p>
            </div>
            {canClear ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onClearFinish(selected)}
                icon={<X className="size-3" aria-hidden="true" />}
                className="h-7 px-2 text-[11px]"
              >
                Clear selection
              </Button>
            ) : null}
          </div>

          {staleMaterial ? (
            <div
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-[2px] border border-amber/30 bg-amber-soft/70 px-3 py-2 text-[11px] leading-4 text-ink-2"
            >
              <AlertTriangle
                className="mt-0.5 size-3.5 shrink-0 text-amber"
                aria-hidden="true"
              />
              <p>
                This material doesn’t fit this surface. Choose a new
                material below.
              </p>
            </div>
          ) : null}

          {selected.material_id === null ? (
            <p className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-amber">
              <AlertTriangle
                className="size-3.5 shrink-0"
                aria-hidden="true"
              />
              No material chosen yet.
            </p>
          ) : null}

          <div className="mt-3">
            <p className="text-xs font-semibold text-ink-2">
              Material
            </p>
            {materialsLoading && materials.length === 0 ? (
              <p className="mt-2 text-[11px] text-muted">
                Loading the material catalog…
              </p>
            ) : materials.length === 0 ? (
              <div className="mt-2 flex items-start gap-2 rounded-[2px] border border-danger/25 bg-danger-soft/60 px-3 py-2">
                <AlertTriangle
                  className="mt-0.5 size-3.5 shrink-0 text-danger"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] leading-4 text-danger">
                    The material catalog did not load.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onReloadMaterials}
                    icon={
                      <RefreshCw
                        className="size-3"
                        aria-hidden="true"
                      />
                    }
                    className="mt-1.5 h-7 px-2 text-[11px]"
                  >
                    Retry
                  </Button>
                </div>
              </div>
            ) : applicableMaterials.length === 0 ? (
              <p className="mt-2 text-[11px] leading-4 text-muted">
                No catalog material fits this surface.
              </p>
            ) : (
              <div
                role="group"
                aria-label={`Materials for ${selected.name}`}
                className="mt-2 grid gap-1.5 sm:grid-cols-2"
              >
                {applicableMaterials.map((material) => {
                  const active = selected.material_id === material.id
                  const color =
                    active && selected.color_hex !== null
                      ? selected.color_hex
                      : (material.colors[0] ?? '#cfc9ba')

                  return (
                    <button
                      key={material.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => onSetMaterial(selected, material)}
                      className={cn(
                        'flex items-center gap-2 rounded-[2px] border px-2 py-1.5 text-left transition-colors',
                        active
                          ? 'border-pine bg-pine-soft/55'
                          : 'border-line bg-surface-2/35 hover:border-line-strong hover:bg-surface-2/70',
                      )}
                    >
                      <span
                        className="h-8 w-9 shrink-0 rounded-[1px] border border-ink/10"
                        style={materialSwatchStyle(material, color)}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-semibold text-ink">
                          {material.name}
                        </span>
                        <span className="mt-0.5 block font-mono text-[9px] text-muted">
                          {formatMoney(material.material_rate)} /{' '}
                          {formatUnit(material.unit)}
                        </span>
                      </span>
                      {active ? (
                        <Check
                          className="size-3.5 shrink-0 text-pine"
                          strokeWidth={2.4}
                          aria-hidden="true"
                        />
                      ) : null}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {selectedMaterial !== null ? (
            <>
              <div className="mt-3 rounded-[2px] border border-line bg-surface-2/35 px-3 py-2">
                <p className="flex items-baseline justify-between gap-3 text-[11px]">
                  <span className="text-muted">Catalog rate</span>
                  <span className="font-mono font-semibold text-ink-2">
                    {formatMoney(selectedMaterial.material_rate)} /{' '}
                    {formatUnit(selectedMaterial.unit)}
                  </span>
                </p>
                <p className="mt-1 text-[10px] leading-4 text-muted">
                  {getMaterialNote(selectedMaterial.id)}
                </p>
              </div>

              {selectedMaterial.colors.length > 0 ? (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-ink-2">
                    Colour
                  </p>
                  <div
                    role="group"
                    aria-label={`Colours for ${selected.name}`}
                    className="mt-2 flex flex-wrap gap-1.5"
                  >
                    {selectedMaterial.colors.map((color, index) => {
                      const active = colorsMatch(
                        selected.color_hex,
                        color,
                      )
                      return (
                        <button
                          key={color}
                          type="button"
                          aria-pressed={active}
                          aria-label={`Colour ${index + 1} (${color})`}
                          title={color}
                          onClick={() =>
                            onSetColor(selected, color)
                          }
                          className={cn(
                            'grid size-7 place-items-center rounded-full border transition-transform',
                            active
                              ? 'scale-110 border-pine shadow-sm'
                              : 'border-ink/15 hover:scale-105',
                          )}
                          style={{ backgroundColor: color }}
                        >
                          {active ? (
                            <Check
                              className="size-3.5 text-on-pine drop-shadow-[0_1px_1px_rgba(0,0,0,0.55)]"
                              strokeWidth={2.6}
                              aria-hidden="true"
                            />
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                  <p className="mt-1.5 text-[10px] leading-4 text-muted">
                    {selectedMaterial.texture === 'stone' ||
                    selectedMaterial.texture === 'tile' ||
                    selectedMaterial.texture === 'wood' ||
                    selectedMaterial.texture === 'texture'
                      ? 'The chosen colour tints this texture in the final render.'
                      : 'The chosen colour is used in the final render.'}
                  </p>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
