import { UploadError } from '../onboarding/upload'

// The API reads an image of a timetable up to min(max_timetable_image_bytes, max_material_bytes):
// 3.75 MiB, since Claude's 5 MB limit is measured on the base64, which is 4/3 of the file
// (api/app/config.py, services/timetables.py size_limit). The browser makes the photo fit first.
export const MAX_TIMETABLE_IMAGE_BYTES = Math.floor((5 * 1024 * 1024 * 3) / 4)

// The long side Claude reads a timetable well at; any image over 8000 would be refused.
export const TIMETABLE_MAX_SIDE = 2000

// The quality steps of the JPEG, tried before the drawing gets smaller.
const QUALITIES = [0.85, 0.7, 0.55] as const
// Each smaller drawing is 3/4 of the last, at most this many times (2000 → about 270).
const MAX_SHRINKS = 7
const SHRINK = 0.75

export interface DownscaleOptions {
  maxSide?: number
  maxBytes?: number
}

type Drawable = ImageBitmap

// One drawing of the image at width × height, encoded at each quality on demand. JPEG has no alpha,
// so the drawing starts white: a transparent PNG would otherwise turn black.
interface Surface {
  encode(quality: number): Promise<Blob | null>
}

function drawOn(context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, image: Drawable, width: number, height: number) {
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
}

function surface(image: Drawable, width: number, height: number): Surface {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (context === null) throw new UploadError('image_unreadable')
    drawOn(context, image, width, height)
    return { encode: (quality) => canvas.convertToBlob({ type: 'image/jpeg', quality }) }
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context === null) throw new UploadError('image_unreadable')
  drawOn(context, image, width, height)
  return {
    encode: (quality) =>
      new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', quality)
      }),
  }
}

// A photo of the timetable, made small enough for the API: a long side of at most maxSide and at
// most maxBytes, as JPEG. The quality goes down first (0.85 → 0.7 → 0.55), then the size. An image
// that is already within both is returned as it is, so a clean screenshot keeps its PNG.
// Fails with an UploadError: image_unreadable (the browser cannot open it), file_too_large (nothing
// fits, or the browser cannot draw here and the file is over the limit).
export async function downscaleImage(file: Blob, options: DownscaleOptions = {}): Promise<Blob> {
  const maxSide = options.maxSide ?? TIMETABLE_MAX_SIDE
  const maxBytes = options.maxBytes ?? MAX_TIMETABLE_IMAGE_BYTES
  // An old browser without createImageBitmap: the file goes as it is, if the API takes it.
  if (typeof createImageBitmap === 'undefined') {
    if (file.size <= maxBytes) return file
    throw new UploadError('file_too_large')
  }

  let image: ImageBitmap
  try {
    image = await createImageBitmap(file)
  } catch (error) {
    throw new UploadError('image_unreadable', { cause: error })
  }
  try {
    const longSide = Math.max(image.width, image.height)
    if (longSide <= maxSide && file.size <= maxBytes) return file

    let scale = Math.min(1, maxSide / longSide)
    for (let shrink = 0; shrink <= MAX_SHRINKS; shrink += 1) {
      const width = Math.max(1, Math.round(image.width * scale))
      const height = Math.max(1, Math.round(image.height * scale))
      const drawing = surface(image, width, height)
      for (const quality of QUALITIES) {
        const blob = await drawing.encode(quality)
        if (blob !== null && blob.size <= maxBytes) return blob
      }
      scale *= SHRINK
    }
    throw new UploadError('file_too_large')
  } finally {
    image.close()
  }
}
