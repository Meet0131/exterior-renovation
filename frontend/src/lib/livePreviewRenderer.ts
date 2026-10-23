import type { GeometryPoint, Material, Region } from '../api/types'
import {
  computePreviewPxPerFt,
  getTextureKind,
  getTextureTileFt,
} from './textures'
import type { TextureKind } from './textures'

const MAX_WORKING_WIDTH = 1400
const FEATHER_PX = 1.6
const PAINT_OPACITY = 0.92
const TEXTURE_OPACITY = 0.9
const FALLBACK_COLOR = '#CFC9BA'

const WHITE_X = 0.95047
const WHITE_Z = 1.08883
const LINEAR_LUT = new Float32Array(256)

for (let index = 0; index < 256; index += 1) {
  const channel = index / 255
  LINEAR_LUT[index] =
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
}

interface Lab {
  lightness: number
  a: number
  b: number
}

function rgbToLab(red: number, green: number, blue: number): Lab {
  const r = LINEAR_LUT[red]
  const g = LINEAR_LUT[green]
  const b = LINEAR_LUT[blue]
  const x =
    (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / WHITE_X
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175
  const z =
    (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / WHITE_Z

  const fx = x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116
  const fy = y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116
  const fz = z > 0.008856 ? Math.cbrt(z) : 7.787 * z + 16 / 116

  return {
    lightness: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  }
}

function labToRgb(
  lightness: number,
  a: number,
  b: number,
): [number, number, number] {
  const fy = (lightness + 16) / 116
  const fx = fy + a / 500
  const fz = fy - b / 200

  const x = WHITE_X * inverseLabCurve(fx)
  const y = inverseLabCurve(fy)
  const z = WHITE_Z * inverseLabCurve(fz)

  const linearRed = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z
  const linearGreen = -0.969266 * x + 1.8760108 * y + 0.041556 * z
  const linearBlue = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z

  return [
    encodeChannel(linearRed),
    encodeChannel(linearGreen),
    encodeChannel(linearBlue),
  ]
}

function inverseLabCurve(value: number): number {
  const cube = value ** 3
  return cube > 0.008856 ? cube : (value - 16 / 116) / 7.787
}

function encodeChannel(value: number): number {
  const clamped = Math.min(1, Math.max(0, value))
  const encoded =
    clamped <= 0.0031308
      ? clamped * 12.92
      : 1.055 * clamped ** (1 / 2.4) - 0.055
  return Math.round(encoded * 255)
}

function hexToRgb(value: string): [number, number, number] | null {
  const raw = value.trim().replace(/^#/, '')
  if (raw.length !== 6) return null
  const parsed = Number.parseInt(raw, 16)
  if (Number.isNaN(parsed)) return null
  return [(parsed >> 16) & 0xff, (parsed >> 8) & 0xff, parsed & 0xff]
}

function resolveColor(
  region: Region,
  material: Material,
): [number, number, number] | null {
  return (
    hexToRgb(region.color_hex ?? '') ??
    material.colors
      .map((color) => hexToRgb(color))
      .find((color) => color !== null) ??
    hexToRgb(FALLBACK_COLOR)
  )
}

function polygonSignature(points: GeometryPoint[]): string {
  return points
    .map((point) => `${point.x.toFixed(6)},${point.y.toFixed(6)}`)
    .join(';')
}

function tracePolygon(
  context: CanvasRenderingContext2D,
  points: GeometryPoint[],
  width: number,
  height: number,
): void {
  context.beginPath()
  points.forEach((point, index) => {
    const x = point.x * width
    const y = point.y * height
    if (index === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  })
  context.closePath()
}

function polygonBounds(
  points: GeometryPoint[],
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  let minX = width
  let maxX = 0
  let minY = height
  let maxY = 0
  for (const point of points) {
    minX = Math.min(minX, Math.floor(point.x * width))
    maxX = Math.max(maxX, Math.ceil(point.x * width))
    minY = Math.min(minY, Math.floor(point.y * height))
    maxY = Math.max(maxY, Math.ceil(point.y * height))
  }
  minX = Math.max(0, minX)
  minY = Math.max(0, minY)
  maxX = Math.min(width - 1, maxX)
  maxY = Math.min(height - 1, maxY)
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX + 1),
    height: Math.max(1, maxY - minY + 1),
  }
}

function isDrawablePolygon(region: Region): boolean {
  return (
    region.geometry_type === 'polygon' &&
    region.geometry_json.length >= 3
  )
}

function createWorkingCanvas(
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function buildReliefTile(
  kind: TextureKind,
  size: number,
): Float32Array {
  const canvas = createWorkingCanvas(size, size)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) return new Float32Array(size * size).fill(1)

  context.fillStyle = 'rgb(235,235,235)'
  context.fillRect(0, 0, size, size)
  context.lineCap = 'butt'

  const stroke = (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    color: string,
    opacity: number,
    thickness: number,
  ) => {
    context.globalAlpha = opacity
    context.strokeStyle = color
    context.lineWidth = Math.max(1, thickness)
    context.beginPath()
    context.moveTo(startX, startY)
    context.lineTo(endX, endY)
    context.stroke()
  }

  const circle = (
    centerX: number,
    centerY: number,
    radius: number,
    color: string,
    opacity: number,
  ) => {
    context.globalAlpha = opacity
    context.fillStyle = color
    context.beginPath()
    context.arc(centerX, centerY, Math.max(1, radius), 0, Math.PI * 2)
    context.fill()
  }

  if (kind === 'soft') {
    circle(size * 0.18, size * 0.3, size * 0.05, '#000000', 0.06)
    circle(size * 0.62, size * 0.68, size * 0.07, '#FFFFFF', 0.12)
    circle(size * 0.82, size * 0.18, size * 0.035, '#000000', 0.05)
    circle(size * 0.34, size * 0.84, size * 0.045, '#FFFFFF', 0.08)
  }

  if (kind === 'stone') {
    const rows = 4
    const columns = 3
    const rowHeight = size / rows

    for (let row = 0; row < rows; row += 1) {
      const y = Math.round(row * rowHeight)
      stroke(0, y, size - 1, y, '#000000', 0.22, size * 0.012)
      stroke(
        0,
        Math.round(y + size * 0.014),
        size - 1,
        Math.round(y + size * 0.014),
        '#FFFFFF',
        0.16,
        size * 0.006,
      )

      const offset = row % 2 === 0 ? 0 : 0.5
      for (let column = 0; column < columns; column += 1) {
        const x = Math.round(((column + offset) * size) / columns)
        if (x >= size) continue
        stroke(
          x,
          y,
          x,
          Math.round(y + rowHeight),
          '#000000',
          0.2,
          size * 0.01,
        )
      }
    }

    circle(size * 0.62, size * 0.18, size * 0.03, '#000000', 0.05)
    circle(size * 0.28, size * 0.72, size * 0.025, '#FFFFFF', 0.1)
  }

  if (kind === 'tile') {
    const divisions = 4
    const cell = size / divisions
    for (let index = 1; index < divisions; index += 1) {
      const position = Math.round(index * cell)
      stroke(position, 0, position, size - 1, '#000000', 0.18, size * 0.012)
      stroke(0, position, size - 1, position, '#000000', 0.18, size * 0.012)
      const highlight = Math.round(position + size * 0.012)
      stroke(highlight, 0, highlight, size - 1, '#FFFFFF', 0.12, size * 0.005)
      stroke(0, highlight, size - 1, highlight, '#FFFFFF', 0.12, size * 0.005)
    }
  }

  if (kind === 'wood') {
    const planks = 4
    const plankWidth = size / planks

    for (let index = 0; index < planks; index += 1) {
      const x = Math.round(index * plankWidth)
      stroke(x, 0, x, size - 1, '#000000', 0.28, size * 0.012)
      stroke(
        Math.round(x + size * 0.01),
        0,
        Math.round(x + size * 0.01),
        size - 1,
        '#FFFFFF',
        0.1,
        size * 0.005,
      )

      for (const [grainX, sway, color, opacity, thickness] of [
        [x + plankWidth * 0.35, 0.02, '#000000', 0.08, size * 0.005],
        [x + plankWidth * 0.68, 0.015, '#FFFFFF', 0.08, size * 0.004],
      ] as const) {
        context.globalAlpha = opacity
        context.strokeStyle = color
        context.lineWidth = Math.max(1, thickness)
        context.beginPath()
        context.moveTo(grainX, 0)
        context.bezierCurveTo(
          grainX + sway * size,
          size * 0.3,
          grainX - sway * size,
          size * 0.7,
          grainX,
          size,
        )
        context.stroke()
      }
    }
  }

  context.globalAlpha = 1

  const data = context.getImageData(0, 0, size, size).data
  const gray = new Float32Array(size * size)
  let total = 0
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4
    const value =
      data[offset] * 0.299 +
      data[offset + 1] * 0.587 +
      data[offset + 2] * 0.114
    gray[index] = value
    total += value
  }

  const mean = Math.max(total / gray.length, 1)
  for (let index = 0; index < gray.length; index += 1) {
    gray[index] /= mean
  }
  return gray
}

interface RegionMask {
  alpha: Uint8ClampedArray
  x: number
  y: number
  width: number
  height: number
}

interface RenderInput {
  canvas: HTMLCanvasElement
  source: HTMLImageElement
  imageWidth: number
  imageHeight: number
  regions: Region[]
  materials: Material[]
  scaleFtPerPx: number | null
}

export class LivePreviewRenderer {
  private workingWidth = 0
  private workingHeight = 0
  private maskKey = ''
  private masks = new Map<string, RegionMask>()
  private reliefs = new Map<string, Float32Array>()

  get workingSize(): { width: number; height: number } {
    return { width: this.workingWidth, height: this.workingHeight }
  }

  render({
    canvas,
    source,
    imageWidth,
    imageHeight,
    regions,
    materials,
    scaleFtPerPx,
  }: RenderInput): void {
    const width = Math.max(
      1,
      Math.min(imageWidth, MAX_WORKING_WIDTH),
    )
    const height = Math.max(
      1,
      Math.round((imageHeight * width) / imageWidth),
    )
    if (width !== this.workingWidth || height !== this.workingHeight) {
      this.workingWidth = width
      this.workingHeight = height
      this.masks.clear()
      this.maskKey = ''
    }

    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context === null) return

    context.clearRect(0, 0, width, height)
    context.drawImage(source, 0, 0, width, height)
    const frame = context.getImageData(0, 0, width, height)
    const pixels = frame.data
    const materialById = new Map<string, Material>()
    for (const material of materials) {
      materialById.set(material.id, material)
    }

    const sortedRegions = [...regions].sort(
      (first, second) => first.sort_order - second.sort_order,
    )
    const openingPoints = sortedRegions
      .filter(
        (region) =>
          region.region_role === 'opening' &&
          isDrawablePolygon(region),
      )
      .map((region) => region.geometry_json)

    this.syncMasks(sortedRegions, openingPoints, width, height)

    const { pxPerFt } = computePreviewPxPerFt(scaleFtPerPx)
    const workingPxPerFt = pxPerFt * (width / imageWidth)

    const lastPolygonIndex = new Map<string, number>()
    sortedRegions.forEach((region, index) => {
      if (region.region_role === 'finish' && isDrawablePolygon(region)) {
        lastPolygonIndex.set(
          polygonSignature(region.geometry_json),
          index,
        )
      }
    })

    for (const [index, region] of sortedRegions.entries()) {
      if (region.region_role !== 'finish') continue
      if (region.material_id === null) continue
      if (!isDrawablePolygon(region)) continue
      if (
        lastPolygonIndex.get(polygonSignature(region.geometry_json)) !==
        index
      ) {
        continue
      }

      const material = materialById.get(region.material_id)
      if (material === undefined) continue
      if (material.category === 'railing') continue
      if (!material.surfaces.includes(region.surface_type)) continue

      const kind = getTextureKind(material.texture)
      if (kind === 'metal' || kind === 'glass' || kind === 'none') continue

      const color = resolveColor(region, material)
      if (color === null) continue

      const mask = this.masks.get(region.id)
      if (mask === undefined) continue

      if (kind === 'paint') {
        this.paintRegion(pixels, mask, width, color, null)
        continue
      }

      const tileFt = getTextureTileFt(kind) ?? 2
      const tilePx = Math.max(24, Math.round(tileFt * workingPxPerFt))
      const relief = this.reliefFor(kind, tilePx)
      this.paintRegion(pixels, mask, width, color, { relief, tilePx })
    }

    context.putImageData(frame, 0, 0)
  }

  private syncMasks(
    regions: Region[],
    openings: GeometryPoint[][],
    width: number,
    height: number,
  ): void {
    const geometryKey = [
      width,
      height,
      ...regions.map(
        (region) =>
          `${region.id}:${region.region_role}:${polygonSignature(region.geometry_json)}`,
      ),
    ].join('|')

    if (geometryKey === this.maskKey) return
    this.maskKey = geometryKey
    this.masks.clear()

    const canvas = createWorkingCanvas(width, height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context === null) return

    for (const region of regions) {
      if (region.region_role !== 'finish' || !isDrawablePolygon(region)) {
        continue
      }

      context.clearRect(0, 0, width, height)
      context.globalCompositeOperation = 'source-over'
      context.filter = `blur(${FEATHER_PX}px)`
      context.fillStyle = '#FFFFFF'
      tracePolygon(context, region.geometry_json, width, height)
      context.fill()

      context.globalCompositeOperation = 'destination-out'
      for (const opening of openings) {
        tracePolygon(context, opening, width, height)
        context.fill()
      }
      context.globalCompositeOperation = 'source-over'
      context.filter = 'none'

      const bounds = polygonBounds(
        region.geometry_json,
        width,
        height,
      )
      const data = context.getImageData(
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
      ).data
      const alpha = new Uint8ClampedArray(bounds.width * bounds.height)
      for (let index = 0; index < alpha.length; index += 1) {
        alpha[index] = data[index * 4 + 3]
      }
      this.masks.set(region.id, { alpha, ...bounds })
    }
  }

  private reliefFor(kind: TextureKind, tilePx: number): Float32Array {
    const key = `${kind}:${tilePx}`
    const cached = this.reliefs.get(key)
    if (cached !== undefined) return cached
    const relief = buildReliefTile(kind, tilePx)
    this.reliefs.set(key, relief)
    return relief
  }

  private paintRegion(
    pixels: Uint8ClampedArray,
    mask: RegionMask,
    width: number,
    color: [number, number, number],
    texture: { relief: Float32Array; tilePx: number } | null,
  ): void {
    const minX = mask.x
    const minY = mask.y
    const maxX = mask.x + mask.width - 1
    const maxY = mask.y + mask.height - 1

    let total = 0
    let count = 0
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const maskAlpha =
          mask.alpha[(y - mask.y) * mask.width + (x - mask.x)]
        if (maskAlpha < 128) continue
        const offset = (y * width + x) * 4
        const lightness = rgbToLab(
          pixels[offset],
          pixels[offset + 1],
          pixels[offset + 2],
        ).lightness
        total += lightness
        count += 1
      }
    }
    if (count === 0) return

    const meanLightness = Math.max(total / count, 1)
    const target = rgbToLab(color[0], color[1], color[2])
    const opacity = texture === null ? PAINT_OPACITY : TEXTURE_OPACITY
    const tilePx = texture?.tilePx ?? 0

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const maskAlpha =
          mask.alpha[(y - mask.y) * mask.width + (x - mask.x)]
        if (maskAlpha === 0) continue

        const offset = (y * width + x) * 4
        const source = rgbToLab(
          pixels[offset],
          pixels[offset + 1],
          pixels[offset + 2],
        )
        const ratio = Math.min(
          1.5,
          Math.max(0.45, source.lightness / meanLightness),
        )
        let shaped = target.lightness * ratio ** 0.9
        if (texture !== null) {
          shaped *= texture.relief[(y % tilePx) * tilePx + (x % tilePx)]
        }

        const [red, green, blue] = labToRgb(
          Math.min(100, Math.max(0, shaped)),
          target.a,
          target.b,
        )
        const alpha = (maskAlpha / 255) * opacity
        pixels[offset] = pixels[offset] * (1 - alpha) + red * alpha
        pixels[offset + 1] =
          pixels[offset + 1] * (1 - alpha) + green * alpha
        pixels[offset + 2] =
          pixels[offset + 2] * (1 - alpha) + blue * alpha
      }
    }
  }
}
