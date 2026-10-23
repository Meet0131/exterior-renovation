export const MAX_PHOTO_BYTES = 10 * 1024 * 1024
export const MIN_PHOTO_LONG_SIDE = 640
export const PHOTO_ACCEPT =
  'image/jpeg,image/png,image/webp,image/mpo,.jpg,.jpeg,.png,.webp,.mpo'

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/x-png',
  'image/webp',
  'image/mpo',
])

const UNKNOWN_MIME_TYPES = new Set(['', 'application/octet-stream'])

export interface PhotoFileInspection {
  width: number | null
  height: number | null
  mimeLabel: string
}

export type PhotoFileCheck =
  | { ok: true; photo: PhotoFileInspection }
  | { ok: false; message: string }

function isMpoFile(file: File): boolean {
  return (
    file.type.trim().toLowerCase() === 'image/mpo' ||
    file.name.toLowerCase().endsWith('.mpo')
  )
}

function getPhotoTypeLabel(file: File): string {
  if (isMpoFile(file)) return 'MPO'

  switch (file.type.trim().toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg':
    case 'image/pjpeg':
      return 'JPEG'
    case 'image/png':
    case 'image/x-png':
      return 'PNG'
    case 'image/webp':
      return 'WebP'
  }

  const name = file.name.toLowerCase()
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'JPEG'
  if (name.endsWith('.png')) return 'PNG'
  if (name.endsWith('.webp')) return 'WebP'
  return 'Photo'
}

async function decodePhoto(
  file: File,
): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file)
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return size
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()

    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
      })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('The photo could not be decoded.'))
    }
    image.src = url
  })
}

export async function inspectPhotoFile(
  file: File,
): Promise<PhotoFileCheck> {
  if (file.size === 0) {
    return { ok: false, message: 'That file is empty. Choose a photo.' }
  }

  const mime = file.type.trim().toLowerCase()
  const hasKnownMime = !UNKNOWN_MIME_TYPES.has(mime)

  if (hasKnownMime && !ALLOWED_MIME_TYPES.has(mime)) {
    return { ok: false, message: 'Use a JPEG, PNG or WebP photo.' }
  }

  if (file.size > MAX_PHOTO_BYTES) {
    return {
      ok: false,
      message: 'That photo is larger than 10 MB. Choose a smaller file.',
    }
  }

  const mimeLabel = getPhotoTypeLabel(file)

  // MPO (phone JPEG) and files with no useful MIME can still be accepted by
  // the server, so the browser decode gate stays out of their way.
  if (isMpoFile(file) || !hasKnownMime) {
    return {
      ok: true,
      photo: { width: null, height: null, mimeLabel },
    }
  }

  let size: { width: number; height: number }
  try {
    size = await decodePhoto(file)
  } catch {
    return {
      ok: false,
      message: 'This photo can’t be opened. Try a different file.',
    }
  }

  if (Math.max(size.width, size.height) < MIN_PHOTO_LONG_SIDE) {
    return {
      ok: false,
      message: `Use a photo at least ${MIN_PHOTO_LONG_SIDE} pixels on its long side.`,
    }
  }

  return {
    ok: true,
    photo: {
      width: size.width,
      height: size.height,
      mimeLabel,
    },
  }
}
