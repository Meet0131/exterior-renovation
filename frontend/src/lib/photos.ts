import type { ProjectImage } from '../api/types'

export const PROJECT_PHOTO_LIMIT = 10

export function sortProjectImages(images: ProjectImage[]): ProjectImage[] {
  return [...images].sort(
    (first, second) =>
      first.sort_order - second.sort_order ||
      first.id.localeCompare(second.id),
  )
}

export function photoLabel(images: ProjectImage[], imageId: string): string {
  const index = sortProjectImages(images).findIndex(
    (image) => image.id === imageId,
  )
  return index < 0 ? 'This photo' : `Photo ${index + 1}`
}

export function photoNumber(images: ProjectImage[], imageId: string): string {
  const index = sortProjectImages(images).findIndex(
    (image) => image.id === imageId,
  )
  return index < 0 ? '—' : String(index + 1).padStart(2, '0')
}
