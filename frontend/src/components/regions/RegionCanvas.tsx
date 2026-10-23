import { useId, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react'
import { sourceImageUrl } from '../../api/images'
import type {
  Calibration,
  GeometryPoint,
  GeometryType,
  ProjectImage,
  Region,
} from '../../api/types'
import { cn } from '../../lib/cn'
import { formatNumber } from '../../lib/format'
import { toPixels } from '../../lib/geometry'
import {
  MIN_LINE_POINTS,
  MIN_POLYGON_POINTS,
  computeRegionGeometryProblem,
  computeScaleDisplay,
  getRegionDisplayColor,
} from '../../lib/regions'
import type { SuggestionReviewItem } from '../../lib/regions'

const CLOSE_TAP_RADIUS_PX = 22

interface RegionCanvasProps {
  image: ProjectImage
  regions: Region[]
  selectedRegionId: string | null
  calibration: Calibration | null
  scaleFtPerPx: number | null
  calibrationDraft: GeometryPoint[] | null
  drawingTool: GeometryType | null
  draftGeometryType: GeometryType | null
  drawPoints: GeometryPoint[]
  drawError: string | null
  pendingPoints: GeometryPoint[] | null
  pendingGeometryType: GeometryType | null
  suggestions: SuggestionReviewItem[]
  hiddenSuggestionKey: string | null
  activeSuggestionKey: string | null
  containerRef: RefObject<HTMLDivElement | null>
  onSelectRegion: (regionId: string) => void
  onSelectSuggestion: (key: string) => void
  onCalibrationPoint: (point: GeometryPoint) => void
  onMoveCalibrationPoint: (index: 0 | 1, point: GeometryPoint) => void
  onCalibrationDragEnd: () => void
  onAddDrawPoint: (point: GeometryPoint) => void
  onFinishDraw: () => void
  onPendingPointChange: (points: GeometryPoint[]) => void
  onRegionGeometryChange: (
    regionId: string,
    points: GeometryPoint[],
  ) => void
}

interface CalibrationDrag {
  index: 0 | 1
  pointerId: number
}

interface VertexDrag {
  regionId: string
  geometryType: GeometryType
  index: number
  pointerId: number
  points: GeometryPoint[]
  moved: boolean
}

interface PendingDrag {
  geometryType: GeometryType
  index: number
  pointerId: number
  points: GeometryPoint[]
  moved: boolean
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function readNormalizedPoint(
  event: { clientX: number; clientY: number },
  container: HTMLElement,
): GeometryPoint {
  const rect = container.getBoundingClientRect()

  if (rect.width === 0 || rect.height === 0) {
    return { x: 0, y: 0 }
  }

  return {
    x: clampUnit((event.clientX - rect.left) / rect.width),
    y: clampUnit((event.clientY - rect.top) / rect.height),
  }
}

function clampLabelValue(value: number): number {
  return Math.min(0.94, Math.max(0.06, value))
}

export function RegionCanvas({
  image,
  regions,
  selectedRegionId,
  calibration,
  scaleFtPerPx,
  calibrationDraft,
  drawingTool,
  draftGeometryType,
  drawPoints,
  drawError,
  pendingPoints,
  pendingGeometryType,
  suggestions,
  hiddenSuggestionKey,
  activeSuggestionKey,
  containerRef,
  onSelectRegion,
  onSelectSuggestion,
  onCalibrationPoint,
  onMoveCalibrationPoint,
  onCalibrationDragEnd,
  onAddDrawPoint,
  onFinishDraw,
  onPendingPointChange,
  onRegionGeometryChange,
}: RegionCanvasProps) {
  const rawPatternId = useId()
  const hatchId = `opening-hatch-${rawPatternId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const glowId = `selected-glow-${rawPatternId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const dragRef = useRef<CalibrationDrag | null>(null)
  const vertexDragRef = useRef<VertexDrag | null>(null)
  const pendingDragRef = useRef<PendingDrag | null>(null)
  const [keyboardCursor, setKeyboardCursor] = useState<GeometryPoint>({
    x: 0.5,
    y: 0.5,
  })
  const [drawCursor, setDrawCursor] = useState<GeometryPoint | null>(null)
  const [pendingDrag, setPendingDrag] = useState<PendingDrag | null>(null)
  const [vertexDrag, setVertexDrag] = useState<VertexDrag | null>(null)
  const [selectedVertex, setSelectedVertex] = useState<{
    regionId: string
    index: number
  } | null>(null)
  const [vertexError, setVertexError] = useState<string | null>(null)

  const { width, height } = image
  const scaleDisplay = computeScaleDisplay(scaleFtPerPx)
  const drawingScale = calibrationDraft !== null
  const drawingShape = drawingTool !== null
  const editingPendingShape =
    pendingPoints !== null && pendingGeometryType !== null
  const interactionLocked =
    drawingScale ||
    drawingShape ||
    drawPoints.length > 0 ||
    editingPendingShape
  const draftPoints = calibrationDraft ?? []
  const selectedRegion =
    regions.find((region) => region.id === selectedRegionId) ?? null
  const selectedPoints =
    selectedRegion === null
      ? null
      : vertexDrag !== null &&
          vertexDrag.regionId === selectedRegion.id
        ? vertexDrag.points
        : selectedRegion.geometry_json
  const pendingDisplayPoints =
    pendingPoints === null
      ? null
      : (pendingDrag?.points ?? pendingPoints)
  const previewGeometryType =
    pendingGeometryType ?? draftGeometryType
  const previewPoints =
    pendingDisplayPoints ??
    (drawingShape && drawCursor !== null
      ? [...drawPoints, drawCursor]
      : drawPoints)
  const visibleSuggestions = suggestions.filter(
    (suggestion) => suggestion.key !== hiddenSuggestionKey,
  )
  const orderedSuggestions = [...visibleSuggestions].sort(
    (first, second) => {
      const firstActive = first.key === activeSuggestionKey ? 1 : 0
      const secondActive = second.key === activeSuggestionKey ? 1 : 0
      return firstActive - secondActive
    },
  )
  const previewPointString = previewPoints
    .map(
      (point) =>
        `${(point.x * width).toFixed(2)},${(point.y * height).toFixed(2)}`,
    )
    .join(' ')

  const calibrationPoints =
    calibration === null
      ? null
      : [
          { x: calibration.p1_x, y: calibration.p1_y },
          { x: calibration.p2_x, y: calibration.p2_y },
        ]
  const calibrationMidpoint =
    calibrationPoints === null
      ? null
      : {
          x: (calibrationPoints[0].x + calibrationPoints[1].x) / 2,
          y: (calibrationPoints[0].y + calibrationPoints[1].y) / 2,
        }
  const draftMidpoint =
    draftPoints.length === 2
      ? {
          x: (draftPoints[0].x + draftPoints[1].x) / 2,
          y: (draftPoints[0].y + draftPoints[1].y) / 2,
        }
      : null

  const orderedRegions = [...regions].sort((first, second) => {
    const firstSelected = first.id === selectedRegionId ? 1 : 0
    const secondSelected = second.id === selectedRegionId ? 1 : 0
    return firstSelected - secondSelected
  })

  const handleCalibrationClick = (
    event: ReactMouseEvent<SVGRectElement>,
  ) => {
    if (!drawingScale || draftPoints.length >= 2) return
    const container = containerRef.current
    if (container === null) return
    onCalibrationPoint(readNormalizedPoint(event, container))
  }

  const handleDragStart = (
    index: 0 | 1,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { index, pointerId: event.pointerId }
  }

  const handleDragMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const drag = dragRef.current
    const container = containerRef.current
    if (
      drag === null ||
      container === null ||
      drag.pointerId !== event.pointerId
    ) {
      return
    }

    onMoveCalibrationPoint(
      drag.index,
      readNormalizedPoint(event, container),
    )
  }

  const handleDragEnd = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    onCalibrationDragEnd()
  }

  const handleCanvasKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    if (!drawingScale) return

    if (event.key === 'Enter' || event.key === ' ') {
      if (draftPoints.length >= 2) return
      event.preventDefault()
      onCalibrationPoint(keyboardCursor)
      return
    }

    const step = event.shiftKey ? 0.05 : 0.01
    let dx = 0
    let dy = 0

    if (event.key === 'ArrowLeft') dx = -step
    else if (event.key === 'ArrowRight') dx = step
    else if (event.key === 'ArrowUp') dy = -step
    else if (event.key === 'ArrowDown') dy = step
    else return

    event.preventDefault()
    setKeyboardCursor((current) => ({
      x: clampUnit(current.x + dx),
      y: clampUnit(current.y + dy),
    }))
  }

  const handleHandleKeyDown = (
    index: 0 | 1,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    if (calibrationPoints === null) return

    const step = event.shiftKey ? 0.05 : 0.01
    let dx = 0
    let dy = 0

    if (event.key === 'ArrowLeft') dx = -step
    else if (event.key === 'ArrowRight') dx = step
    else if (event.key === 'ArrowUp') dy = -step
    else if (event.key === 'ArrowDown') dy = step
    else return

    event.preventDefault()
    const current = calibrationPoints[index]
    onMoveCalibrationPoint(index, {
      x: clampUnit(current.x + dx),
      y: clampUnit(current.y + dy),
    })
  }

  const startVertexDrag = (
    region: Region,
    index: number,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)

    const drag: VertexDrag = {
      regionId: region.id,
      geometryType: region.geometry_type,
      index,
      pointerId: event.pointerId,
      points: region.geometry_json.map((point) => ({ ...point })),
      moved: false,
    }
    vertexDragRef.current = drag
    setVertexDrag(drag)
    setSelectedVertex({ regionId: region.id, index })
    setVertexError(null)
  }

  const moveVertexDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = vertexDragRef.current
    const container = containerRef.current
    if (
      drag === null ||
      container === null ||
      drag.pointerId !== event.pointerId
    ) {
      return
    }

    const point = readNormalizedPoint(event, container)
    const nextDrag: VertexDrag = {
      ...drag,
      moved: true,
      points: drag.points.map((current, index) =>
        index === drag.index ? point : current,
      ),
    }
    vertexDragRef.current = nextDrag
    setVertexDrag(nextDrag)
  }

  const endVertexDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const drag = vertexDragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    vertexDragRef.current = null
    setVertexDrag(null)

    if (!drag.moved) return

    const problem = computeRegionGeometryProblem(
      drag.geometryType,
      drag.points,
    )
    if (problem !== null) {
      setVertexError(problem)
      return
    }

    setVertexError(null)
    onRegionGeometryChange(drag.regionId, drag.points)
  }

  const removeVertex = (region: Region, index: number) => {
    const minimum =
      region.geometry_type === 'polygon'
        ? MIN_POLYGON_POINTS
        : MIN_LINE_POINTS

    if (region.geometry_json.length <= minimum) {
      setVertexError(
        region.geometry_type === 'polygon'
          ? 'A polygon needs at least three points.'
          : 'A line needs at least two points.',
      )
      return
    }

    const nextPoints = region.geometry_json.filter(
      (_, pointIndex) => pointIndex !== index,
    )
    const problem = computeRegionGeometryProblem(
      region.geometry_type,
      nextPoints,
    )
    if (problem !== null) {
      setVertexError(problem)
      return
    }

    setSelectedVertex(null)
    setVertexError(null)
    onRegionGeometryChange(region.id, nextPoints)
  }

  const insertVertex = (region: Region, segmentIndex: number) => {
    const points = region.geometry_json
    const start = points[segmentIndex]
    const end = points[(segmentIndex + 1) % points.length]
    const midpoint = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    }
    const nextPoints = [
      ...points.slice(0, segmentIndex + 1),
      midpoint,
      ...points.slice(segmentIndex + 1),
    ]
    const problem = computeRegionGeometryProblem(
      region.geometry_type,
      nextPoints,
    )
    if (problem !== null) {
      setVertexError(problem)
      return
    }

    setSelectedVertex({
      regionId: region.id,
      index: segmentIndex + 1,
    })
    setVertexError(null)
    onRegionGeometryChange(region.id, nextPoints)
  }

  const handleVertexKeyDown = (
    region: Region,
    index: number,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      vertexDragRef.current = null
      setVertexDrag(null)
      setSelectedVertex(null)
      setVertexError(null)
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      event.currentTarget.blur()
      return
    }

    if (
      (event.key === 'Delete' || event.key === 'Backspace') &&
      selectedVertex?.regionId === region.id &&
      selectedVertex.index === index
    ) {
      event.preventDefault()
      event.stopPropagation()
      removeVertex(region, index)
    }
  }

  const handleDrawClick = (
    event: ReactMouseEvent<SVGRectElement>,
  ) => {
    if (event.detail > 1) return

    const container = containerRef.current
    if (container === null) return
    const point = readNormalizedPoint(event, container)

    if (
      draftGeometryType === 'polygon' &&
      drawPoints.length >= MIN_POLYGON_POINTS
    ) {
      const first = drawPoints[0]
      const rect = container.getBoundingClientRect()
      const offsetX = (point.x - first.x) * rect.width
      const offsetY = (point.y - first.y) * rect.height
      if (Math.hypot(offsetX, offsetY) <= CLOSE_TAP_RADIUS_PX) {
        onFinishDraw()
        return
      }
    }

    onAddDrawPoint(point)
  }

  const handleDrawPointerMove = (
    event: ReactPointerEvent<SVGRectElement>,
  ) => {
    const container = containerRef.current
    if (container === null) return
    setDrawCursor(readNormalizedPoint(event, container))
  }

  const handleDrawDoubleClick = (
    event: ReactMouseEvent<SVGRectElement>,
  ) => {
    event.preventDefault()
    onFinishDraw()
  }

  const startPendingDrag = (
    index: number,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (pendingPoints === null || pendingGeometryType === null) return

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)

    const drag: PendingDrag = {
      geometryType: pendingGeometryType,
      index,
      pointerId: event.pointerId,
      points: pendingPoints.map((point) => ({ ...point })),
      moved: false,
    }
    pendingDragRef.current = drag
    setPendingDrag(drag)
    setVertexError(null)
  }

  const movePendingDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const drag = pendingDragRef.current
    const container = containerRef.current
    if (
      drag === null ||
      container === null ||
      drag.pointerId !== event.pointerId
    ) {
      return
    }

    const point = readNormalizedPoint(event, container)
    const nextDrag: PendingDrag = {
      ...drag,
      moved: true,
      points: drag.points.map((current, index) =>
        index === drag.index ? point : current,
      ),
    }
    pendingDragRef.current = nextDrag
    setPendingDrag(nextDrag)
  }

  const endPendingDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const drag = pendingDragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    pendingDragRef.current = null
    setPendingDrag(null)

    if (!drag.moved) return

    const problem = computeRegionGeometryProblem(
      drag.geometryType,
      drag.points,
    )
    if (problem !== null) {
      setVertexError(problem)
      return
    }

    setVertexError(null)
    onPendingPointChange(drag.points)
  }

  return (
    <div className="relative">
      <div
        ref={containerRef}
        tabIndex={drawingScale ? 0 : -1}
        role="group"
        aria-label={
          drawingScale
            ? 'Facade photo. Click two points on a known length, or use the arrow keys and Enter.'
            : regions.length === 0
              ? 'Facade photo. No regions are marked yet.'
              : 'Facade photo with marked regions. Select a region to inspect it.'
        }
        aria-describedby={
          drawingScale ? 'region-canvas-keyboard-hint' : undefined
        }
        onKeyDown={handleCanvasKeyDown}
        className="group relative mx-auto w-full touch-manipulation bg-ink/5"
        style={{
          aspectRatio: `${width} / ${height}`,
        }}
      >
        <img
          src={sourceImageUrl(image.id)}
          alt="Your facade photo"
          width={width}
          height={height}
          draggable={false}
          className="absolute inset-0 size-full select-none object-contain"
        />

        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="absolute inset-0 size-full"
          aria-hidden="true"
        >
          <defs>
            <filter
              id={glowId}
              x="-20%"
              y="-20%"
              width="140%"
              height="140%"
            >
              <feDropShadow
                dx="0"
                dy="0"
                stdDeviation="3"
                floodColor="#235844"
                floodOpacity="0.95"
              />
            </filter>
            <pattern
              id={hatchId}
              width="14"
              height="14"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="14"
                className="stroke-amber"
                strokeWidth="2"
              />
            </pattern>
          </defs>

          {orderedRegions.map((region) => {
            const selected = region.id === selectedRegionId
            const color = getRegionDisplayColor(region)
            const regionPoints =
              vertexDrag !== null && vertexDrag.regionId === region.id
                ? vertexDrag.points
                : region.geometry_json
            const shapePoints = toPixels(
              regionPoints,
              width,
              height,
            )
            const pointString = shapePoints
              .map((point) => `${point.x},${point.y}`)
              .join(' ')

            if (region.geometry_type === 'line') {
              return (
                <g key={region.id}>
                  <polyline
                    points={pointString}
                    fill="none"
                    stroke={color}
                    strokeWidth={selected ? 5 : 4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  />
                  {selected ? (
                    <g pointerEvents="none">
                      <polyline
                        points={pointString}
                        fill="none"
                        stroke="var(--color-surface)"
                        strokeWidth="11"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                        opacity="0.9"
                      />
                      <polyline
                        points={pointString}
                        fill="none"
                        stroke="var(--color-pine)"
                        strokeWidth="4.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                        filter={`url(#${glowId})`}
                      />
                      <polyline
                        points={pointString}
                        fill="none"
                        stroke="var(--color-surface)"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeDasharray="10 7"
                        vectorEffect="non-scaling-stroke"
                        className="region-march"
                      />
                    </g>
                  ) : null}
                  <polyline
                    points={pointString}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="24"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents={
                      interactionLocked ? 'none' : 'stroke'
                    }
                    className="cursor-pointer"
                    onClick={(event) => {
                      event.stopPropagation()
                      onSelectRegion(region.id)
                    }}
                  />
                </g>
              )
            }

            const isOpening = region.region_role === 'opening'
            const isReference = region.region_role === 'reference'

            return (
              <g key={region.id}>
                <polygon
                  points={pointString}
                  fill={
                    isReference
                      ? 'none'
                      : isOpening
                        ? `url(#${hatchId})`
                        : color
                  }
                  fillOpacity={
                    isReference ? 0 : isOpening ? 1 : selected ? 0.34 : 0.14
                  }
                  stroke={color}
                  strokeWidth={selected ? 3 : 2}
                  strokeDasharray={
                    isReference || isOpening ? '6 4' : undefined
                  }
                  vectorEffect="non-scaling-stroke"
                  pointerEvents={
                    interactionLocked ? 'none' : 'visiblePainted'
                  }
                  className="cursor-pointer transition-[fill-opacity] duration-150"
                  onClick={(event) => {
                    event.stopPropagation()
                    onSelectRegion(region.id)
                  }}
                />
                {selected ? (
                  <g pointerEvents="none">
                    {!isReference ? (
                      <polygon
                        points={pointString}
                        fill="var(--color-pine)"
                        fillOpacity="0.2"
                        stroke="none"
                        vectorEffect="non-scaling-stroke"
                      />
                    ) : null}
                    <polygon
                      points={pointString}
                      fill="none"
                      stroke="var(--color-surface)"
                      strokeWidth="8"
                      vectorEffect="non-scaling-stroke"
                      opacity="0.9"
                    />
                    <polygon
                      points={pointString}
                      fill="none"
                      stroke="var(--color-pine)"
                      strokeWidth="4"
                      vectorEffect="non-scaling-stroke"
                      filter={`url(#${glowId})`}
                    />
                    <polygon
                      points={pointString}
                      fill="none"
                      stroke="var(--color-surface)"
                      strokeWidth="1.5"
                      strokeDasharray="10 7"
                      vectorEffect="non-scaling-stroke"
                      className="region-march"
                    />
                  </g>
                ) : null}
              </g>
            )
          })}

          {orderedSuggestions.map((suggestion) => {
            const active = suggestion.key === activeSuggestionKey
            const shapePoints = toPixels(
              suggestion.geometry_json,
              width,
              height,
            )
            const pointString = shapePoints
              .map((point) => `${point.x},${point.y}`)
              .join(' ')

            if (suggestion.geometry_type === 'line') {
              return (
                <g key={suggestion.key}>
                  <title>{suggestion.name}</title>
                  <polyline
                    points={pointString}
                    fill="none"
                    stroke="var(--color-surface)"
                    strokeWidth={active ? '11' : '6'}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    opacity="0.8"
                    pointerEvents="none"
                  />
                  <polyline
                    points={pointString}
                    fill="none"
                    className={active ? 'stroke-pine' : 'stroke-measure'}
                    strokeWidth={active ? '4.5' : '2.5'}
                    strokeDasharray={active ? undefined : '10 6'}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    filter={active ? `url(#${glowId})` : undefined}
                    pointerEvents="none"
                  />
                  {active ? (
                    <polyline
                      points={pointString}
                      fill="none"
                      stroke="var(--color-surface)"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeDasharray="10 7"
                      vectorEffect="non-scaling-stroke"
                      className="region-march"
                      pointerEvents="none"
                    />
                  ) : null}
                  {interactionLocked || active ? null : (
                    <polyline
                      points={pointString}
                      fill="none"
                      stroke="transparent"
                      strokeWidth="24"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="stroke"
                      className="cursor-pointer"
                      onClick={(event) => {
                        event.stopPropagation()
                        onSelectSuggestion(suggestion.key)
                      }}
                    />
                  )}
                </g>
              )
            }

            return (
              <g key={suggestion.key}>
                <title>{suggestion.name}</title>
                <polygon
                  points={pointString}
                  fill="none"
                  stroke="var(--color-surface)"
                  strokeWidth={active ? '8' : '6'}
                  vectorEffect="non-scaling-stroke"
                  opacity="0.8"
                  pointerEvents="none"
                />
                <polygon
                  points={pointString}
                  fill={active ? 'var(--color-pine)' : 'var(--color-measure)'}
                  fillOpacity={active ? 0.22 : 0.06}
                  className={cn(
                    'transition-[fill-opacity] duration-150',
                    active ? 'stroke-pine' : 'stroke-measure',
                    interactionLocked || active
                      ? 'pointer-events-none'
                      : 'cursor-pointer',
                  )}
                  strokeWidth={active ? '4' : '2.5'}
                  strokeDasharray={active ? undefined : '10 6'}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  filter={active ? `url(#${glowId})` : undefined}
                  pointerEvents={
                    interactionLocked || active
                      ? 'none'
                      : 'visiblePainted'
                  }
                  onClick={(event) => {
                    event.stopPropagation()
                    onSelectSuggestion(suggestion.key)
                  }}
                />
                {active ? (
                  <polygon
                    points={pointString}
                    fill="none"
                    stroke="var(--color-surface)"
                    strokeWidth="1.5"
                    strokeDasharray="10 7"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    className="region-march"
                    pointerEvents="none"
                  />
                ) : null}
              </g>
            )
          })}

          {previewPoints.length > 0 && previewGeometryType !== null ? (
            <g pointerEvents="none">
              {previewGeometryType === 'polygon' && !drawingShape ? (
                <polygon
                  points={previewPointString}
                  fill="var(--color-pine)"
                  fillOpacity="0.12"
                  className="stroke-pine"
                  strokeWidth="3"
                  strokeDasharray="8 5"
                  vectorEffect="non-scaling-stroke"
                />
              ) : (
                <polyline
                  points={previewPointString}
                  fill="none"
                  className="stroke-pine"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {draftGeometryType === 'polygon' &&
              drawingShape &&
              previewPoints.length >= 3 ? (
                <line
                  x1={
                    previewPoints[previewPoints.length - 1].x * width
                  }
                  y1={
                    previewPoints[previewPoints.length - 1].y * height
                  }
                  x2={previewPoints[0].x * width}
                  y2={previewPoints[0].y * height}
                  className="stroke-pine"
                  strokeWidth="2"
                  strokeDasharray="5 5"
                  vectorEffect="non-scaling-stroke"
                  opacity="0.55"
                />
              ) : null}
            </g>
          ) : null}

          {calibrationPoints !== null ? (
            <g
              opacity={drawingScale ? 0.38 : 1}
              pointerEvents="none"
            >
              <line
                x1={calibrationPoints[0].x * width}
                y1={calibrationPoints[0].y * height}
                x2={calibrationPoints[1].x * width}
                y2={calibrationPoints[1].y * height}
                stroke="var(--color-surface)"
                strokeWidth="6"
                vectorEffect="non-scaling-stroke"
                opacity="0.8"
              />
              <line
                x1={calibrationPoints[0].x * width}
                y1={calibrationPoints[0].y * height}
                x2={calibrationPoints[1].x * width}
                y2={calibrationPoints[1].y * height}
                className="stroke-measure"
                strokeWidth="2.5"
                strokeDasharray="7 5"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ) : null}

          {draftPoints.length === 2 ? (
            <g pointerEvents="none">
              <line
                x1={draftPoints[0].x * width}
                y1={draftPoints[0].y * height}
                x2={draftPoints[1].x * width}
                y2={draftPoints[1].y * height}
                stroke="var(--color-surface)"
                strokeWidth="6"
                vectorEffect="non-scaling-stroke"
                opacity="0.85"
              />
              <line
                x1={draftPoints[0].x * width}
                y1={draftPoints[0].y * height}
                x2={draftPoints[1].x * width}
                y2={draftPoints[1].y * height}
                className="stroke-measure"
                strokeWidth="3"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ) : null}

          {drawingScale ? (
            <rect
              x="0"
              y="0"
              width={width}
              height={height}
              fill="transparent"
              className={cn(
                'cursor-crosshair',
                draftPoints.length >= 2
                  ? 'pointer-events-none'
                  : 'pointer-events-auto',
              )}
              onClick={handleCalibrationClick}
            />
          ) : drawingShape ? (
            <rect
              x="0"
              y="0"
              width={width}
              height={height}
              fill="transparent"
              className="cursor-crosshair touch-none"
              onClick={handleDrawClick}
              onPointerMove={handleDrawPointerMove}
              onPointerLeave={() => setDrawCursor(null)}
              onDoubleClick={handleDrawDoubleClick}
            />
          ) : null}
        </svg>

        {calibrationPoints !== null &&
        calibrationMidpoint !== null &&
        !drawingScale ? (
          <div
            className="pointer-events-none absolute z-10 rounded-[2px] border border-measure/30 bg-measure-soft/95 px-2 py-1 text-[10px] font-medium text-measure shadow-sm backdrop-blur-sm"
            style={{
              left: `${clampLabelValue(calibrationMidpoint.x) * 100}%`,
              top: `${clampLabelValue(calibrationMidpoint.y) * 100}%`,
              transform:
                calibrationMidpoint.y > 0.14
                  ? 'translate(-50%, calc(-100% - 10px))'
                  : 'translate(-50%, 10px)',
            }}
          >
            {formatNumber(calibration?.length_ft ?? 0, 2)} ft reference
          </div>
        ) : null}

        {draftMidpoint !== null ? (
          <div
            className="pointer-events-none absolute z-10 rounded-[2px] border border-measure/30 bg-measure-soft/95 px-2 py-1 text-[10px] font-medium text-measure shadow-sm backdrop-blur-sm"
            style={{
              left: `${clampLabelValue(draftMidpoint.x) * 100}%`,
              top: `${clampLabelValue(draftMidpoint.y) * 100}%`,
              transform:
                draftMidpoint.y > 0.14
                  ? 'translate(-50%, calc(-100% - 10px))'
                  : 'translate(-50%, 10px)',
            }}
          >
            Type the real length
          </div>
        ) : null}

        {calibrationPoints !== null && !drawingScale
          ? ([0, 1] as const).map((index) => {
              const point = calibrationPoints[index]
              return (
                <button
                  key={index}
                  type="button"
                  aria-label={`Move scale point ${index + 1}`}
                  aria-describedby="scale-handle-hint"
                  title={`Move scale point ${index + 1}`}
                  onPointerDown={(event) =>
                    handleDragStart(index, event)
                  }
                  onPointerMove={handleDragMove}
                  onPointerUp={handleDragEnd}
                  onPointerCancel={handleDragEnd}
                  onKeyDown={(event) =>
                    handleHandleKeyDown(index, event)
                  }
                  className="absolute z-20 size-6 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-surface bg-measure shadow-[0_0_0_1px_var(--color-measure)] transition-transform hover:scale-110 focus-visible:scale-110"
                  style={{
                    left: `${point.x * 100}%`,
                    top: `${point.y * 100}%`,
                  }}
                />
              )
            })
          : null}

        <span id="scale-handle-hint" className="sr-only">
          Use the arrow keys to move this point. Hold Shift for a larger
          step.
        </span>

        {draftPoints.map((point, index) => (
          <span
            key={`draft-${index}`}
            className="pointer-events-none absolute z-20 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-measure shadow-[0_0_0_1px_var(--color-measure)]"
            style={{
              left: `${point.x * 100}%`,
              top: `${point.y * 100}%`,
            }}
            aria-hidden="true"
          />
        ))}

        {pendingDisplayPoints !== null &&
        pendingGeometryType !== null
          ? pendingDisplayPoints.map((point, index) => (
              <button
                key={`pending-${index}`}
                type="button"
                aria-label={`Point ${index + 1} of the new shape`}
                aria-describedby="pending-shape-hint"
                title="Drag this point to adjust the shape"
                onPointerDown={(event) =>
                  startPendingDrag(index, event)
                }
                onPointerMove={movePendingDrag}
                onPointerUp={endPendingDrag}
                onPointerCancel={endPendingDrag}
                className="absolute z-30 size-4 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-surface bg-pine shadow-[0_0_0_1px_var(--color-pine)] transition-transform hover:scale-110 focus-visible:scale-110 [@media(pointer:coarse)]:size-6"
                style={{
                  left: `${point.x * 100}%`,
                  top: `${point.y * 100}%`,
                }}
              />
            ))
          : null}

        <span id="pending-shape-hint" className="sr-only">
          Drag a point to adjust this shape before adding it. An
          invalid shape reverts to the last valid one.
        </span>

        {pendingPoints === null
          ? drawPoints.map((point, index) => {
          const canClose =
            drawingShape &&
            draftGeometryType === 'polygon' &&
            index === 0 &&
            drawPoints.length >= MIN_POLYGON_POINTS

          if (canClose) {
            return (
              <button
                key={`draw-${index}`}
                type="button"
                aria-label="Close the polygon"
                title="Close the polygon"
                onClick={(event) => {
                  event.stopPropagation()
                  onFinishDraw()
                }}
                className="group/close absolute z-20 size-11 -translate-x-1/2 -translate-y-1/2 touch-manipulation rounded-full"
                style={{
                  left: `${point.x * 100}%`,
                  top: `${point.y * 100}%`,
                }}
              >
                <span className="mx-auto grid size-7 place-items-center rounded-full border-2 border-surface bg-pine shadow-[0_0_0_2px_var(--color-pine)] transition-transform group-hover/close:scale-110">
                  <span className="block size-1.5 rounded-full bg-on-pine" />
                </span>
              </button>
            )
          }

          return (
            <span
              key={`draw-${index}`}
              className="pointer-events-none absolute z-20 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-pine shadow-[0_0_0_1px_var(--color-pine)]"
              style={{
                left: `${point.x * 100}%`,
                top: `${point.y * 100}%`,
              }}
              aria-hidden="true"
            />
          )
            })
          : null}

        {drawingShape && drawCursor !== null && drawPoints.length > 0 ? (
          <span
            className="pointer-events-none absolute z-20 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-pine/70 bg-pine/15"
            style={{
              left: `${drawCursor.x * 100}%`,
              top: `${drawCursor.y * 100}%`,
            }}
            aria-hidden="true"
          />
        ) : null}

        {!interactionLocked &&
        selectedRegion !== null &&
        selectedPoints !== null ? (
          <>
            {vertexDrag === null
              ? Array.from(
                  {
                    length:
                      selectedRegion.geometry_type === 'polygon'
                        ? selectedPoints.length
                        : selectedPoints.length - 1,
                  },
                  (_, segmentIndex) => {
                    const start = selectedPoints[segmentIndex]
                    const end =
                      selectedPoints[
                        (segmentIndex + 1) % selectedPoints.length
                      ]
                    return (
                      <button
                        key={`midpoint-${segmentIndex}`}
                        type="button"
                        aria-label={`Insert a point after point ${segmentIndex + 1}`}
                        title="Insert a point here"
                        onClick={(event) => {
                          event.stopPropagation()
                          insertVertex(selectedRegion, segmentIndex)
                        }}
                        className="absolute z-20 grid size-3.5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-dashed border-pine/70 bg-surface/95 text-[9px] font-bold leading-none text-pine shadow-sm transition-colors hover:bg-pine-soft [@media(pointer:coarse)]:size-5"
                        style={{
                          left: `${((start.x + end.x) / 2) * 100}%`,
                          top: `${((start.y + end.y) / 2) * 100}%`,
                        }}
                      >
                        +
                      </button>
                    )
                  },
                )
              : null}

            {selectedPoints.map((point, index) => (
              <button
                key={`vertex-${index}`}
                type="button"
                aria-label={`Point ${index + 1} of ${selectedRegion.name}`}
                aria-describedby="region-vertex-hint"
                title={`Point ${index + 1}. Drag to move, or press Delete to remove.`}
                onPointerDown={(event) =>
                  startVertexDrag(selectedRegion, index, event)
                }
                onPointerMove={moveVertexDrag}
                onPointerUp={endVertexDrag}
                onPointerCancel={endVertexDrag}
                onFocus={() =>
                  setSelectedVertex({
                    regionId: selectedRegion.id,
                    index,
                  })
                }
                onKeyDown={(event) =>
                  handleVertexKeyDown(selectedRegion, index, event)
                }
                className={cn(
                  'absolute z-30 size-4 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-surface shadow-[0_0_0_1px_var(--color-pine)] transition-transform hover:scale-110 focus-visible:scale-110 [@media(pointer:coarse)]:size-6',
                  selectedVertex?.regionId === selectedRegion.id &&
                    selectedVertex.index === index
                    ? 'bg-measure shadow-[0_0_0_2px_var(--color-measure)]'
                    : 'bg-pine',
                )}
                style={{
                  left: `${point.x * 100}%`,
                  top: `${point.y * 100}%`,
                }}
              />
            ))}
          </>
        ) : null}

        <span id="region-vertex-hint" className="sr-only">
          Drag this point to move it. Press Delete or Backspace to remove
          it, or Escape to stop editing.
        </span>

        {drawingScale ? (
          <span
            className="pointer-events-none absolute z-20 hidden size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-measure bg-measure/20 shadow-[0_0_0_1px_var(--color-surface)] group-focus:block"
            style={{
              left: `${keyboardCursor.x * 100}%`,
              top: `${keyboardCursor.y * 100}%`,
            }}
            aria-hidden="true"
          >
            <span className="absolute left-1/2 top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-measure" />
          </span>
        ) : null}

        <span id="region-canvas-keyboard-hint" className="sr-only">
          Use the arrow keys to move the point and press Enter to place
          it. Hold Shift for a larger step.
        </span>

        {scaleDisplay !== null ? (
          <div className="pointer-events-none absolute left-2 top-2 z-10 inline-flex max-w-[48%] items-center gap-1.5 rounded-[2px] border border-line/80 bg-surface/92 px-2 py-1 text-[10px] shadow-sm backdrop-blur-sm">
            <span
              className="size-1.5 shrink-0 rounded-full bg-ok"
              aria-hidden="true"
            />
            <span className="font-mono">
              {scaleDisplay.feetPerPixel} ft/px
            </span>
          </div>
        ) : null}

        {drawError !== null ? (
          <div
            className="pointer-events-none absolute inset-x-2 bottom-2 z-10 mx-auto w-fit max-w-[calc(100%-1rem)] rounded-[2px] border border-danger/35 bg-danger-soft/97 px-2.5 py-1.5 text-center text-[10px] font-medium leading-4 text-danger shadow-sm backdrop-blur-sm"
            role="alert"
          >
            {drawError}
          </div>
        ) : vertexError !== null ? (
          <div
            className="pointer-events-none absolute inset-x-2 bottom-2 z-10 mx-auto w-fit max-w-[calc(100%-1rem)] rounded-[2px] border border-danger/35 bg-danger-soft/97 px-2.5 py-1.5 text-center text-[10px] font-medium leading-4 text-danger shadow-sm backdrop-blur-sm"
            role="alert"
          >
            {vertexError}
          </div>
        ) : null}
      </div>
    </div>
  )
}
