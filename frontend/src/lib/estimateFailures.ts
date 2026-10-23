import { ApiError } from '../api/client'
import { getImageEstimate } from '../api/estimate'
import type { ProjectImage } from '../api/types'

export interface PhotoEstimateFailure {
  imageId: string
  message: string
}

export async function probePhotoEstimateFailures(
  images: ProjectImage[],
): Promise<PhotoEstimateFailure[]> {
  const results = await Promise.all(
    images.map(async (image) => {
      try {
        await getImageEstimate(image.id)
        return null
      } catch (error) {
        if (error instanceof ApiError && error.status === 422) {
          return { imageId: image.id, message: error.message }
        }
        return null
      }
    }),
  )

  return results.filter(
    (result): result is PhotoEstimateFailure => result !== null,
  )
}
