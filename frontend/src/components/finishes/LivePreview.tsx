import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type {
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react'
import { ChevronsLeftRight, RotateCcw } from 'lucide-react'
import { sourceImageUrl } from '../../api/images'
import type {
  GeometryPoint,
  Material,
  ProjectImage,
  Region,
} from '../../api/types'
import {
  computePreviewPxPerFt,
  getTextureKind,
} from '../../lib/textures'
import type { TextureKind } from '../../lib/textures'
import { LivePreviewRenderer } from '../../lib/livePreviewRenderer'
import { Button } from '../ui/Button'

const DEFAULT_SPLIT = 50

interface LivePreviewProps {
  image: ProjectImage
  regions: Region[]
  materials: Material[]
  selectedRegionId: string | null
  scaleFtPerPx: number | null
}

function toPixelPoints(
  points: GeometryPoint[],
  width: number,
  height: number,
): GeometryPoint[] {
  return points.map((point) => ({
    x: point.x * width,
    y: point.y * height,
  }))
}

function toPointsString(
  points: GeometryPoint[],
  width: number,
  height: number,
): string {
  return points
    .map(
      (point) =>
        `${(point.x * width).toFixed(1)},${(point.y * height).toFixed(1)}`,
    )
    .join(' ')
}

function samplePolylinePoints(
  points: GeometryPoint[],
  spacing: number,
): GeometryPoint[] {
  const samples: GeometryPoint[] = []
  let travelled = 0
  let next = spacing

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    const length = Math.hypot(end.x - start.x, end.y - start.y)
    if (length === 0) continue

    while (next <= travelled + length) {
      const ratio = (next - travelled) / length
      samples.push({
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
      })
      next += spacing
    }

    travelled += length
  }

  return samples
}

interface RailingOverlayProps {
  region: Region
  kind: TextureKind
  color: string
  width: number
  height: number
  pxPerFt: number
}

function RailingOverlay({
  region,
  kind,
  color,
  width,
  height,
  pxPerFt,
}: RailingOverlayProps) {
  const pixelPoints = toPixelPoints(
    region.geometry_json,
    width,
    height,
  )
  const points = pixelPoints
    .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(' ')
  const postSpacing = Math.max(width * 0.02, pxPerFt * 4)
  const postHeight = Math.max(width * 0.008, pxPerFt * 0.6)
  const railWidth = Math.max(
    width * 0.003,
    pxPerFt * (kind === 'glass' ? 0.06 : 0.09),
  )
  const posts = samplePolylinePoints(pixelPoints, postSpacing)

  if (kind === 'glass') {
    const bandWidth = Math.max(width * 0.009, pxPerFt * 0.8)
    return (
      <g>
        <polyline
          points={points}
          fill="none"
          stroke="#103227"
          strokeOpacity={0.25}
          strokeWidth={bandWidth + railWidth * 1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeOpacity={0.4}
          strokeWidth={bandWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points={points}
          fill="none"
          stroke="#FFFFFF"
          strokeOpacity={0.28}
          strokeWidth={bandWidth * 0.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {posts.map((post, index) => (
          <line
            key={index}
            x1={post.x}
            y1={post.y - postHeight / 2}
            x2={post.x}
            y2={post.y + postHeight / 2}
            stroke={color}
            strokeWidth={railWidth * 0.8}
            strokeLinecap="round"
          />
        ))}
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={railWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    )
  }

  return (
    <g>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeOpacity={0.95}
        strokeWidth={railWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points={points}
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity={0.3}
        strokeWidth={railWidth * 0.35}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {posts.map((post, index) => (
        <line
          key={index}
          x1={post.x}
          y1={post.y - postHeight / 2}
          x2={post.x}
          y2={post.y + postHeight / 2}
          stroke={color}
          strokeOpacity={0.9}
          strokeWidth={railWidth * 0.85}
          strokeLinecap="round"
        />
      ))}
    </g>
  )
}

interface PreviewLayersProps {
  regions: Region[]
  materials: Material[]
  width: number
  height: number
  scaleFtPerPx: number | null
  selectedRegionId: string | null
}

const PreviewLayers = memo(function PreviewLayers({
  regions,
  materials,
  width,
  height,
  scaleFtPerPx,
  selectedRegionId,
}: PreviewLayersProps) {
  const materialById = useMemo(() => {
    const byId = new Map<string, Material>()
    for (const material of materials) byId.set(material.id, material)
    return byId
  }, [materials])

  const sortedRegions = useMemo(
    () =>
      [...regions].sort(
        (first, second) => first.sort_order - second.sort_order,
      ),
    [regions],
  )

  const { pxPerFt } = computePreviewPxPerFt(scaleFtPerPx)

  const referenceLayers = sortedRegions
    .filter((region) => region.region_role === 'reference')
    .map((region) => {
      const points = toPointsString(
        region.geometry_json,
        width,
        height,
      )
      const strokeWidth = Math.max(1.5, width * 0.0014)

      return region.geometry_type === 'line' ? (
        <polyline
          key={region.id}
          points={points}
          fill="none"
          stroke="#103227"
          strokeOpacity={0.5}
          strokeWidth={strokeWidth}
          strokeDasharray="8 6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <polygon
          key={region.id}
          points={points}
          fill="none"
          stroke="#103227"
          strokeOpacity={0.45}
          strokeWidth={strokeWidth}
          strokeDasharray="8 6"
          strokeLinejoin="round"
        />
      )
    })

  const railingLayers = sortedRegions
    .filter(
      (region) =>
        region.region_role === 'finish' &&
        region.geometry_type === 'line' &&
        region.geometry_json.length >= 2,
    )
    .map((region) => {
      if (region.material_id === null) return null
      const material = materialById.get(region.material_id)
      if (material === undefined) return null
      if (!material.surfaces.includes(region.surface_type)) return null

      const kind = getTextureKind(material.texture)
      if (kind !== 'metal' && kind !== 'glass') return null

      const color =
        region.color_hex ??
        material.colors[0] ??
        (kind === 'glass' ? '#B7C4C9' : '#2F3437')

      return (
        <RailingOverlay
          key={region.id}
          region={region}
          kind={kind}
          color={color}
          width={width}
          height={height}
          pxPerFt={pxPerFt}
        />
      )
    })

  const selectedRegion =
    sortedRegions.find(
      (region) => region.id === selectedRegionId,
    ) ?? null
  let selectedLayer: ReactNode = null

  if (selectedRegion !== null) {
    const points = toPointsString(
      selectedRegion.geometry_json,
      width,
      height,
    )
    const strokeWidth = Math.max(2, width * 0.0025)
    const haloWidth = strokeWidth * 3
    const accentWidth = strokeWidth * 1.6

    selectedLayer =
      selectedRegion.geometry_type === 'line' ? (
        <g key="selected">
          <polyline
            points={points}
            fill="none"
            stroke="var(--color-surface)"
            strokeWidth={haloWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.9}
          />
          <polyline
            points={points}
            fill="none"
            stroke="var(--color-amber)"
            strokeWidth={accentWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      ) : (
        <g key="selected">
          <polygon
            points={points}
            fill="var(--color-amber)"
            fillOpacity={0.16}
          />
          <polygon
            points={points}
            fill="none"
            stroke="var(--color-surface)"
            strokeWidth={haloWidth}
            strokeLinejoin="round"
            opacity={0.9}
          />
          <polygon
            points={points}
            fill="none"
            stroke="var(--color-amber)"
            strokeWidth={accentWidth}
            strokeLinejoin="round"
          />
        </g>
      )
  }

  return (
    <>
      {referenceLayers}
      {railingLayers}
      {selectedLayer}
    </>
  )
})

export function LivePreview({
  image,
  regions,
  materials,
  selectedRegionId,
  scaleFtPerPx,
}: LivePreviewProps) {
  const [split, setSplit] = useState(DEFAULT_SPLIT)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<LivePreviewRenderer | null>(null)
  const [source, setSource] = useState<{
    url: string
    photo: HTMLImageElement
  } | null>(null)
  const draggingRef = useRef(false)
  const { approximate } = computePreviewPxPerFt(scaleFtPerPx)
  const photoUrl = sourceImageUrl(image.id)
  const readySource = source?.url === photoUrl ? source.photo : null

  if (rendererRef.current === null) {
    rendererRef.current = new LivePreviewRenderer()
  }

  useEffect(() => {
    let cancelled = false
    const photo = new Image()
    photo.decoding = 'async'
    const handleLoad = () => {
      if (!cancelled) setSource({ url: photoUrl, photo })
    }
    photo.addEventListener('load', handleLoad)
    photo.src = photoUrl
    return () => {
      cancelled = true
      photo.removeEventListener('load', handleLoad)
    }
  }, [photoUrl])

  useEffect(() => {
    const canvas = canvasRef.current
    const renderer = rendererRef.current
    if (canvas === null || renderer === null || readySource === null) {
      return
    }
    renderer.render({
      canvas,
      source: readySource,
      imageWidth: image.width,
      imageHeight: image.height,
      regions,
      materials,
      scaleFtPerPx,
    })
  }, [
    readySource,
    image.width,
    image.height,
    regions,
    materials,
    scaleFtPerPx,
  ])

  const readSplit = (clientX: number): number => {
    const frame = frameRef.current
    if (frame === null) return split
    const rect = frame.getBoundingClientRect()
    if (rect.width === 0) return split
    const percent = ((clientX - rect.left) / rect.width) * 100
    return Math.round(Math.min(100, Math.max(0, percent)))
  }

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    draggingRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    setSplit(readSplit(event.clientX))
  }

  const handlePointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (!draggingRef.current) return
    setSplit(readSplit(event.clientX))
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <section className="overflow-hidden rounded-[2px] border border-line bg-surface shadow-sheet">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-measure">
            Live preview
          </p>
          <p className="display mt-0.5 truncate text-base font-semibold tracking-tight">
            Before and after
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            Preview, not a construction drawing.
          </p>
        </div>
      </div>

      <div
        ref={frameRef}
        className="relative touch-pan-y select-none overflow-hidden bg-surface-2"
        style={{
          aspectRatio: `${image.width} / ${image.height}`,
          cursor: 'ew-resize',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <img
          src={sourceImageUrl(image.id)}
          alt="Original facade photo"
          width={image.width}
          height={image.height}
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
        />

        <div
          className="absolute inset-0"
          style={{ clipPath: `inset(0 0 0 ${split}%)` }}
        >
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            className="absolute inset-0 h-full w-full"
          />
          <svg
            viewBox={`0 0 ${image.width} ${image.height}`}
            preserveAspectRatio="none"
            role="img"
            aria-label="Live material preview over the facade photo"
            className="absolute inset-0 h-full w-full"
          >
            <PreviewLayers
              regions={regions}
              materials={materials}
              width={image.width}
              height={image.height}
              scaleFtPerPx={scaleFtPerPx}
              selectedRegionId={selectedRegionId}
            />
          </svg>
        </div>

        <div
          className="pointer-events-none absolute inset-y-0 z-10"
          style={{ left: `${split}%` }}
          aria-hidden="true"
        >
          <span className="absolute inset-y-0 left-0 w-0.5 -translate-x-1/2 bg-white/95 shadow-[0_0_0_1px_rgba(0,0,0,0.18)]" />
          <span className="absolute top-1/2 left-0 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-line-strong bg-surface text-ink-2 shadow-sheet">
            <ChevronsLeftRight className="size-3.5" />
          </span>
        </div>

        <span className="pointer-events-none absolute top-3 left-3 z-10 rounded-full border border-white/20 bg-ink/65 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">
          Original
        </span>
        <span className="pointer-events-none absolute top-3 right-3 z-10 rounded-full border border-white/20 bg-ink/65 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">
          Redesign
        </span>
      </div>

      <div className="flex items-center gap-2.5 border-t border-line px-4 py-3 sm:px-5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted">
          Original
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={split}
          onChange={(event) => setSplit(Number(event.target.value))}
          aria-label="Compare the original photo with the live redesign"
          className="flex-1 cursor-ew-resize accent-pine"
        />
        <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted">
          Redesign
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSplit(DEFAULT_SPLIT)}
          icon={<RotateCcw className="size-3" aria-hidden="true" />}
          className="h-7 px-2 text-[11px]"
        >
          Reset
        </Button>
      </div>

      {approximate ? (
        <div className="border-t border-line px-4 py-3 text-[10px] leading-4 text-amber sm:px-5">
          Preview scale approximate — set a known length in Mark regions
          for true texture size.
        </div>
      ) : null}
    </section>
  )
}
