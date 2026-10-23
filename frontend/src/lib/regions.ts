import type {
  DetectedRegionSuggestion,
  GeometryPoint,
  GeometryType,
  Material,
  Region,
  RegionPatchPayload,
  RegionRole,
  SurfaceType,
} from '../api/types'
import { formatMeasure } from './format'
import { computeRegionFinalMeasure, isSelfIntersecting } from './geometry'
import type { RegionMeasure } from './geometry'

export const SURFACE_LABELS: Record<SurfaceType, string> = {
  wall: 'Wall',
  pillar: 'Pillar',
  parapet: 'Parapet',
  railing: 'Railing',
  balcony_slab: 'Balcony slab',
  gate: 'Gate',
  roof_edge: 'Roof edge',
  trim: 'Trim',
  window: 'Window',
  door: 'Door',
}

export function getSurfaceLabel(surface: SurfaceType): string {
  return SURFACE_LABELS[surface]
}

export const SURFACE_OPTIONS: SurfaceType[] = [
  'wall',
  'pillar',
  'parapet',
  'railing',
  'balcony_slab',
  'gate',
  'roof_edge',
  'trim',
  'window',
  'door',
]

export const MIN_POLYGON_POINTS = 3
export const MIN_LINE_POINTS = 2

export function getSurfaceGeometryType(
  surface: SurfaceType,
): GeometryType {
  return surface === 'railing' ? 'line' : 'polygon'
}

export function getSurfaceRole(surface: SurfaceType): RegionRole {
  if (surface === 'window' || surface === 'door') return 'opening'
  if (surface === 'gate' || surface === 'roof_edge') return 'reference'
  return 'finish'
}

export function getDefaultRegionName(
  surface: SurfaceType,
  regions: Region[],
): string {
  const label = SURFACE_LABELS[surface]
  let highest = 0

  for (const region of regions) {
    if (region.surface_type !== surface) continue
    const match = region.name.match(
      new RegExp(`^${label} (\\d+)$`),
    )
    if (match === null) continue
    highest = Math.max(highest, Number(match[1]))
  }

  return `${label} ${highest + 1}`
}

const SUGGESTION_SIMPLIFY_TOLERANCES = [0.008, 0.012, 0.02]
const SUGGESTION_MAX_POINTS = 12

function pointToSegmentDistance(
  point: GeometryPoint,
  start: GeometryPoint,
  end: GeometryPoint,
): number {
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const lengthSquared = deltaX * deltaX + deltaY * deltaY

  if (lengthSquared < 1e-12) {
    return Math.hypot(point.x - start.x, point.y - start.y)
  }

  const projection = Math.min(
    1,
    Math.max(
      0,
      ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) /
        lengthSquared,
    ),
  )

  return Math.hypot(
    point.x - (start.x + projection * deltaX),
    point.y - (start.y + projection * deltaY),
  )
}

function simplifyPolyline(
  points: GeometryPoint[],
  tolerance: number,
): GeometryPoint[] {
  if (points.length < 3) return points

  const start = points[0]
  const end = points[points.length - 1]
  let farthestIndex = -1
  let farthestDistance = 0

  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = pointToSegmentDistance(
      points[index],
      start,
      end,
    )
    if (distance > farthestDistance) {
      farthestDistance = distance
      farthestIndex = index
    }
  }

  if (farthestDistance <= tolerance) return [start, end]

  const before = simplifyPolyline(
    points.slice(0, farthestIndex + 1),
    tolerance,
  )
  const after = simplifyPolyline(
    points.slice(farthestIndex),
    tolerance,
  )
  return [...before.slice(0, -1), ...after]
}

/**
 * The scan can outline a surface with dozens of points. Editing that many
 * handles is slow, so keep the few points that still describe the shape.
 */
export function simplifyDetectedPolygon(
  points: GeometryPoint[],
): GeometryPoint[] {
  let best = points

  for (const tolerance of SUGGESTION_SIMPLIFY_TOLERANCES) {
    const simplified = simplifyPolyline(points, tolerance)
    if (simplified.length < MIN_POLYGON_POINTS) continue
    if (isSelfIntersecting(simplified, true)) continue
    if (simplified.length < best.length) best = simplified
    if (simplified.length <= SUGGESTION_MAX_POINTS) break
  }

  return best
}

export function computeRegionGeometryProblem(
  geometryType: GeometryType,
  points: { x: number; y: number }[],
): string | null {
  const minimum =
    geometryType === 'polygon' ? MIN_POLYGON_POINTS : MIN_LINE_POINTS
  if (points.length < minimum) {
    return geometryType === 'polygon'
      ? 'A polygon needs at least three points.'
      : 'A line needs at least two points.'
  }

  for (let index = 0; index < points.length - 1; index += 1) {
    if (
      Math.abs(points[index].x - points[index + 1].x) < 1e-9 &&
      Math.abs(points[index].y - points[index + 1].y) < 1e-9
    ) {
      return 'Remove duplicate points that sit on top of each other.'
    }
  }

  const closed = geometryType === 'polygon'
  if (closed && points.length > 1) {
    const first = points[0]
    const last = points[points.length - 1]
    if (
      Math.abs(first.x - last.x) < 1e-9 &&
      Math.abs(first.y - last.y) < 1e-9
    ) {
      return 'A polygon closes automatically; remove the repeated first point.'
    }
  }

  if (isSelfIntersecting(points, closed)) {
    return closed
      ? 'This outline crosses itself. Move a point so the edges do not cross.'
      : 'This line crosses itself. Move a point so the segments do not cross.'
  }

  return null
}

export interface SuggestionReviewItem {
  key: string
  name: string
  geometry_type: GeometryType
  geometry_json: GeometryPoint[]
  surface_type: SurfaceType
  region_role: RegionRole
  confidence: number
  problem: string | null
}

function roleWord(role: RegionRole): string {
  if (role === 'opening') return 'an opening'
  if (role === 'reference') return 'a reference'
  return 'a finish'
}

function distanceBetween(
  first: GeometryPoint,
  second: GeometryPoint,
): number {
  return Math.hypot(second.x - first.x, second.y - first.y)
}

/**
 * The scan returns railing as a thin area. Railings are priced per running
 * foot, so take the longest edge of that area as the railing line. This lets
 * a detected railing be accepted without redrawing it.
 */
export function deriveRailingLineFromArea(
  points: GeometryPoint[],
): GeometryPoint[] | null {
  if (points.length < 2) return null

  let start = points[0]
  let end = points[1]
  let longest = distanceBetween(start, end)

  for (let index = 1; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length]
    const current = points[index]
    const length = distanceBetween(current, next)
    if (length > longest) {
      start = current
      end = next
      longest = length
    }
  }

  if (longest < 1e-9) return null

  return [
    { x: start.x, y: start.y },
    { x: end.x, y: end.y },
  ]
}

export function reviewDetectedSuggestion(
  suggestion: DetectedRegionSuggestion,
  key: string,
): SuggestionReviewItem {
  const label = getSurfaceLabel(suggestion.surface_type)
  const expectedGeometry = getSurfaceGeometryType(
    suggestion.surface_type,
  )
  const expectedRole = getSurfaceRole(suggestion.surface_type)

  let geometryType = suggestion.geometry_type
  let geometryJson = suggestion.geometry_json

  if (
    suggestion.surface_type === 'railing' &&
    suggestion.geometry_type !== 'line'
  ) {
    const railingLine = deriveRailingLineFromArea(
      suggestion.geometry_json,
    )
    if (railingLine !== null) {
      geometryType = 'line'
      geometryJson = railingLine
    }
  }

  if (geometryType === 'polygon') {
    geometryJson = simplifyDetectedPolygon(geometryJson)
  }

  let problem: string | null = null

  if (suggestion.name.trim() === '') {
    problem = 'The scan did not give this region a name. Edit it before accepting.'
  } else if (expectedGeometry !== geometryType) {
    problem =
      expectedGeometry === 'line'
        ? `${label} needs a line, but the scan found an area. Edit it before accepting.`
        : `Only railings use a line. The scan gave ${label} a line. Edit it before accepting.`
  } else if (expectedRole !== suggestion.region_role) {
    problem = `The scan marked ${label} as ${roleWord(suggestion.region_role)}, but it is ${roleWord(expectedRole)}. Edit it before accepting.`
  } else {
    problem = computeRegionGeometryProblem(geometryType, geometryJson)
  }

  return {
    key,
    name: suggestion.name.trim().slice(0, 80),
    geometry_type: geometryType,
    geometry_json: geometryJson,
    surface_type: suggestion.surface_type,
    region_role: suggestion.region_role,
    confidence: suggestion.confidence,
    problem,
  }
}

export interface SurfaceChangeResult {
  ok: boolean
  message?: string
  notice?: string
  patch?: RegionPatchPayload
}

export function computeSurfaceChange(
  region: Region,
  surface: SurfaceType,
  materials: Material[],
): SurfaceChangeResult {
  if (getSurfaceGeometryType(surface) !== region.geometry_type) {
    return {
      ok: false,
      message:
        surface === 'railing'
          ? 'Railing needs a line; draw a new railing region.'
          : 'A railing line can only stay a railing. Draw a new region for this surface.',
    }
  }

  const role = getSurfaceRole(surface)
  const patch: RegionPatchPayload = {
    surface_type: surface,
    region_role: role,
  }
  let clearedFinish = false

  if (role !== 'finish') {
    if (
      region.material_id !== null ||
      region.color_hex !== null ||
      region.material_rate_override !== null ||
      region.labor_rate_override !== null
    ) {
      clearedFinish = true
    }
    patch.material_id = null
    patch.color_hex = null
    patch.material_rate_override = null
    patch.labor_rate_override = null
  } else if (region.material_id !== null) {
    const material =
      materials.find((entry) => entry.id === region.material_id) ?? null
    const catalogUnavailable = materials.length === 0
    if (
      !catalogUnavailable &&
      (material === null || !material.surfaces.includes(surface))
    ) {
      clearedFinish = true
      patch.material_id = null
      patch.color_hex = null
      patch.material_rate_override = null
      patch.labor_rate_override = null
    }
  }

  if (role === 'reference') {
    patch.manual_area_sqft = null
    patch.manual_length_ft = null
    patch.deduction_sqft = 0
  } else if (role === 'opening') {
    patch.deduction_sqft = 0
  }

  return {
    ok: true,
    patch,
    notice: clearedFinish
      ? 'The saved material did not fit this surface, so it was cleared. Choose a material on the Materials screen.'
      : undefined,
  }
}


export function getRegionRoleLabel(region: Region): string {
  if (region.region_role === 'opening') return 'Opening'
  if (region.region_role === 'reference') return 'Reference'
  return 'Finish'
}

export function findRegionMaterial(
  region: Region,
  materials: Material[],
): Material | null {
  if (region.material_id === null) return null
  return (
    materials.find((material) => material.id === region.material_id) ??
    null
  )
}

export function getRegionDisplayColor(region: Region): string {
  if (region.color_hex !== null) return region.color_hex
  if (region.region_role === 'opening') return 'var(--color-amber)'
  if (region.region_role === 'reference') return 'var(--color-faint)'
  return 'var(--color-pine)'
}

export function getRegionSubtitle(
  region: Region,
  materials: Material[],
): string {
  const surface = getSurfaceLabel(region.surface_type)

  if (region.region_role === 'opening') return `${surface} · Opening`
  if (region.region_role === 'reference') {
    return `${surface} · Reference`
  }

  const material = findRegionMaterial(region, materials)
  if (region.material_id === null) {
    return `${surface} · No material yet`
  }
  return `${surface} · ${material?.name ?? 'Material unavailable'}`
}

export function formatRegionMeasure(
  measure: RegionMeasure,
  region: Region,
): string {
  if (measure.kind === 'reference') return 'Reference'
  if (measure.kind === 'unmeasured') {
    return region.region_role === 'opening' ? 'Not measured' : 'Set a scale'
  }
  if (measure.kind === 'area') {
    return formatMeasure(measure.value, 'sqft')
  }
  return formatMeasure(measure.value, 'rft')
}

export interface RegionTotals {
  areaCount: number
  measuredAreaCount: number
  unmeasuredAreaCount: number
  areaTotal: number | null
  railingCount: number
  unmeasuredRailingCount: number
  railingLength: number | null
}

export function computeRegionTotals(
  regions: Region[],
  scaleFtPerPx: number | null,
  width: number,
  height: number,
): RegionTotals {
  const totals: RegionTotals = {
    areaCount: 0,
    measuredAreaCount: 0,
    unmeasuredAreaCount: 0,
    areaTotal: null,
    railingCount: 0,
    unmeasuredRailingCount: 0,
    railingLength: null,
  }

  for (const region of regions) {
    if (region.region_role !== 'finish') continue

    const measure = computeRegionFinalMeasure(
      region,
      scaleFtPerPx,
      width,
      height,
    )

    if (region.geometry_type === 'polygon') {
      totals.areaCount += 1
      if (measure.kind !== 'area') {
        totals.unmeasuredAreaCount += 1
        continue
      }
      totals.measuredAreaCount += 1
      totals.areaTotal = (totals.areaTotal ?? 0) + measure.value
      continue
    }

    totals.railingCount += 1
    if (measure.kind !== 'length') {
      totals.unmeasuredRailingCount += 1
      continue
    }
    totals.railingLength = (totals.railingLength ?? 0) + measure.value
  }

  return totals
}

export function computeScaleDisplay(
  scaleFtPerPx: number | null,
): { feetPerPixel: string; pixelsPerFoot: string } | null {
  if (scaleFtPerPx === null || scaleFtPerPx <= 0) return null
  return {
    feetPerPixel: scaleFtPerPx.toFixed(4),
    pixelsPerFoot: (1 / scaleFtPerPx).toFixed(1),
  }
}
