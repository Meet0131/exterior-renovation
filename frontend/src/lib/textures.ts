export type TextureKind =
  | 'paint'
  | 'soft'
  | 'stone'
  | 'tile'
  | 'wood'
  | 'metal'
  | 'glass'
  | 'none'

const TEXTURE_KINDS: Record<string, TextureKind> = {
  paint: 'paint',
  texture: 'soft',
  stone: 'stone',
  tile: 'tile',
  wood: 'wood',
  metal: 'metal',
  glass: 'glass',
}

// Mirrors _TEXTURE_TILE_FT in the backend preview renderer.
export const TEXTURE_TILE_FT: Partial<Record<TextureKind, number>> = {
  soft: 2,
  stone: 3,
  tile: 2,
  wood: 4,
}

// Browser-only fallback when the photo has no calibration yet.
export const PREVIEW_FALLBACK_PX_PER_FT = 40

export interface PreviewScale {
  pxPerFt: number
  approximate: boolean
}

export function getTextureKind(texture: string | null): TextureKind {
  if (texture === null) return 'none'
  return TEXTURE_KINDS[texture] ?? 'none'
}

export function getTextureTileFt(kind: TextureKind): number | null {
  return TEXTURE_TILE_FT[kind] ?? null
}

export function computePreviewPxPerFt(
  scaleFtPerPx: number | null,
): PreviewScale {
  if (
    scaleFtPerPx !== null &&
    Number.isFinite(scaleFtPerPx) &&
    scaleFtPerPx > 0
  ) {
    return { pxPerFt: 1 / scaleFtPerPx, approximate: false }
  }
  return {
    pxPerFt: PREVIEW_FALLBACK_PX_PER_FT,
    approximate: true,
  }
}
