import type {
  CalibrationPayload,
  GeometryPoint,
  Region,
} from '../api/types'

export interface PixelPoint {
  x: number
  y: number
}

export type RegionMeasure =
  | { kind: 'area'; value: number; source: 'manual' | 'computed' }
  | { kind: 'length'; value: number; source: 'manual' | 'computed' }
  | { kind: 'reference' }
  | { kind: 'unmeasured' }

const EPSILON = 1e-9

export function computeScaleFtPerPx(
  calibration: CalibrationPayload | null,
  width: number,
  height: number,
): number | null {
  if (calibration === null) return null

  const pixelDistance = computePointDistance(
    { x: calibration.p1_x, y: calibration.p1_y },
    { x: calibration.p2_x, y: calibration.p2_y },
    width,
    height,
  )

  if (
    !Number.isFinite(pixelDistance) ||
    pixelDistance <= 0 ||
    !Number.isFinite(calibration.length_ft) ||
    calibration.length_ft <= 0
  ) {
    return null
  }

  return calibration.length_ft / pixelDistance
}

export function toPixels(
  points: GeometryPoint[],
  width: number,
  height: number,
): PixelPoint[] {
  return points.map((point) => ({
    x: point.x * width,
    y: point.y * height,
  }))
}

export function computePointDistance(
  first: GeometryPoint,
  second: GeometryPoint,
  width: number,
  height: number,
): number {
  return Math.hypot(
    (second.x - first.x) * width,
    (second.y - first.y) * height,
  )
}

export function computePolygonAreaSqFt(
  points: GeometryPoint[],
  width: number,
  height: number,
  scaleFtPerPx: number | null,
): number | null {
  if (points.length < 3 || scaleFtPerPx === null) return null

  let doubledArea = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    doubledArea += current.x * next.y - next.x * current.y
  }

  const normalizedArea = Math.abs(doubledArea) / 2
  return (
    normalizedArea *
    width *
    height *
    scaleFtPerPx *
    scaleFtPerPx
  )
}

export function computePolylineLengthFt(
  points: GeometryPoint[],
  width: number,
  height: number,
  scaleFtPerPx: number | null,
): number | null {
  if (points.length < 2 || scaleFtPerPx === null) return null

  let pixelLength = 0
  for (let index = 0; index < points.length - 1; index += 1) {
    pixelLength += computePointDistance(
      points[index],
      points[index + 1],
      width,
      height,
    )
  }

  return pixelLength * scaleFtPerPx
}

export function computeRegionGrossAreaSqFt(
  region: Region,
  scaleFtPerPx: number | null,
  width: number,
  height: number,
): number | null {
  if (region.geometry_type !== 'polygon') return null
  return computePolygonAreaSqFt(
    region.geometry_json,
    width,
    height,
    scaleFtPerPx,
  )
}

export function computeRegionNetAreaSqFt(
  region: Region,
  scaleFtPerPx: number | null,
  width: number,
  height: number,
): number | null {
  const grossArea = computeRegionGrossAreaSqFt(
    region,
    scaleFtPerPx,
    width,
    height,
  )
  if (grossArea === null) return null
  return grossArea - region.deduction_sqft
}

export function computeRegionFinalMeasure(
  region: Region,
  scaleFtPerPx: number | null,
  width: number,
  height: number,
): RegionMeasure {
  if (region.region_role === 'reference') return { kind: 'reference' }

  if (region.geometry_type === 'polygon') {
    if (region.manual_area_sqft !== null) {
      return {
        kind: 'area',
        value: region.manual_area_sqft,
        source: 'manual',
      }
    }

    const netArea = computeRegionNetAreaSqFt(
      region,
      scaleFtPerPx,
      width,
      height,
    )
    if (netArea === null) return { kind: 'unmeasured' }

    return { kind: 'area', value: netArea, source: 'computed' }
  }

  if (region.manual_length_ft !== null) {
    return {
      kind: 'length',
      value: region.manual_length_ft,
      source: 'manual',
    }
  }

  const lengthFt = computePolylineLengthFt(
    region.geometry_json,
    width,
    height,
    scaleFtPerPx,
  )
  if (lengthFt === null) return { kind: 'unmeasured' }

  return { kind: 'length', value: lengthFt, source: 'computed' }
}

export function computePolygonCentroid(
  points: GeometryPoint[],
): GeometryPoint | null {
  if (points.length === 0) return null

  let doubledArea = 0
  let weightedX = 0
  let weightedY = 0

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    const cross = current.x * next.y - next.x * current.y
    doubledArea += cross
    weightedX += (current.x + next.x) * cross
    weightedY += (current.y + next.y) * cross
  }

  if (Math.abs(doubledArea) < EPSILON) {
    return {
      x:
        points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y:
        points.reduce((sum, point) => sum + point.y, 0) / points.length,
    }
  }

  return {
    x: weightedX / (3 * doubledArea),
    y: weightedY / (3 * doubledArea),
  }
}

export function computePolylineMidpoint(
  points: GeometryPoint[],
  width: number,
  height: number,
): GeometryPoint | null {
  if (points.length === 0) return null
  if (points.length === 1) return points[0]

  let totalLength = 0
  for (let index = 0; index < points.length - 1; index += 1) {
    totalLength += computePointDistance(
      points[index],
      points[index + 1],
      width,
      height,
    )
  }

  if (totalLength <= 0) return points[0]

  let travelled = 0
  const halfway = totalLength / 2

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    const segmentLength = computePointDistance(
      start,
      end,
      width,
      height,
    )

    if (travelled + segmentLength >= halfway) {
      const fraction =
        segmentLength === 0 ? 0 : (halfway - travelled) / segmentLength
      return {
        x: start.x + (end.x - start.x) * fraction,
        y: start.y + (end.y - start.y) * fraction,
      }
    }

    travelled += segmentLength
  }

  return points[points.length - 1]
}

export function computeRegionLabelPoint(
  region: Region,
  width: number,
  height: number,
): GeometryPoint | null {
  if (region.geometry_type === 'polygon') {
    return computePolygonCentroid(region.geometry_json)
  }
  return computePolylineMidpoint(region.geometry_json, width, height)
}

export function isSelfIntersecting(
  points: GeometryPoint[],
  closed = true,
): boolean {
  const edgeCount = closed ? points.length : points.length - 1
  if (edgeCount < 3) return false

  for (let firstIndex = 0; firstIndex < edgeCount; firstIndex += 1) {
    const firstStart = points[firstIndex]
    const firstEnd = points[(firstIndex + 1) % points.length]

    for (
      let secondIndex = firstIndex + 1;
      secondIndex < edgeCount;
      secondIndex += 1
    ) {
      const adjacent =
        secondIndex === firstIndex + 1 ||
        (closed &&
          firstIndex === 0 &&
          secondIndex === edgeCount - 1)
      if (adjacent) continue

      const secondStart = points[secondIndex]
      const secondEnd = points[(secondIndex + 1) % points.length]

      if (
        doSegmentsIntersect(
          firstStart,
          firstEnd,
          secondStart,
          secondEnd,
        )
      ) {
        return true
      }
    }
  }

  return false
}

export function hasDuplicateConsecutivePoints(
  points: GeometryPoint[],
  closed = false,
): boolean {
  for (let index = 0; index < points.length - 1; index += 1) {
    if (pointsAreEqual(points[index], points[index + 1])) return true
  }

  if (
    closed &&
    points.length > 1 &&
    pointsAreEqual(points[0], points[points.length - 1])
  ) {
    return true
  }

  return false
}

function pointsAreEqual(
  first: GeometryPoint,
  second: GeometryPoint,
): boolean {
  return (
    Math.abs(first.x - second.x) <= EPSILON &&
    Math.abs(first.y - second.y) <= EPSILON
  )
}

function crossProduct(
  start: GeometryPoint,
  end: GeometryPoint,
  point: GeometryPoint,
): number {
  return (
    (end.x - start.x) * (point.y - start.y) -
    (end.y - start.y) * (point.x - start.x)
  )
}

function isPointOnSegment(
  start: GeometryPoint,
  end: GeometryPoint,
  point: GeometryPoint,
): boolean {
  return (
    Math.abs(crossProduct(start, end, point)) <= EPSILON &&
    point.x >= Math.min(start.x, end.x) - EPSILON &&
    point.x <= Math.max(start.x, end.x) + EPSILON &&
    point.y >= Math.min(start.y, end.y) - EPSILON &&
    point.y <= Math.max(start.y, end.y) + EPSILON
  )
}

function doSegmentsIntersect(
  firstStart: GeometryPoint,
  firstEnd: GeometryPoint,
  secondStart: GeometryPoint,
  secondEnd: GeometryPoint,
): boolean {
  const firstSide = crossProduct(firstStart, firstEnd, secondStart)
  const secondSide = crossProduct(firstStart, firstEnd, secondEnd)
  const thirdSide = crossProduct(secondStart, secondEnd, firstStart)
  const fourthSide = crossProduct(secondStart, secondEnd, firstEnd)

  if (
    ((firstSide > EPSILON && secondSide < -EPSILON) ||
      (firstSide < -EPSILON && secondSide > EPSILON)) &&
    ((thirdSide > EPSILON && fourthSide < -EPSILON) ||
      (thirdSide < -EPSILON && fourthSide > EPSILON))
  ) {
    return true
  }

  if (
    Math.abs(firstSide) <= EPSILON &&
    isPointOnSegment(firstStart, firstEnd, secondStart)
  ) {
    return true
  }
  if (
    Math.abs(secondSide) <= EPSILON &&
    isPointOnSegment(firstStart, firstEnd, secondEnd)
  ) {
    return true
  }
  if (
    Math.abs(thirdSide) <= EPSILON &&
    isPointOnSegment(secondStart, secondEnd, firstStart)
  ) {
    return true
  }
  if (
    Math.abs(fourthSide) <= EPSILON &&
    isPointOnSegment(secondStart, secondEnd, firstEnd)
  ) {
    return true
  }

  return false
}
