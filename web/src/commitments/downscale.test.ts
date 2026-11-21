import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downscaleImage, MAX_TIMETABLE_IMAGE_BYTES } from './downscale'

// A fake encoder: the JPEG of a w×h drawing at quality q weighs w·h·q·bytesPerPixel bytes, so a test
// can choose when a size fits.
interface Encoded {
  width: number
  height: number
  quality: number
}

let encoded: Encoded[] = []
let bytesPerPixel = 0.5
let closed = 0

function bitmap(width: number, height: number) {
  return { width, height, close: () => void (closed += 1) }
}

function blobOf(size: number, type: string): Blob {
  return new Blob([new Uint8Array(size)], { type })
}

function fakeBlob(width: number, height: number, quality: number): Blob {
  encoded.push({ width, height, quality })
  return blobOf(Math.round(width * height * quality * bytesPerPixel), 'image/jpeg')
}

class FakeOffscreenCanvas {
  width: number
  height: number

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }

  getContext() {
    return { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }
  }

  convertToBlob({ quality }: { type: string; quality: number }): Promise<Blob> {
    return Promise.resolve(fakeBlob(this.width, this.height, quality))
  }
}

beforeEach(() => {
  encoded = []
  bytesPerPixel = 0.5
  closed = 0
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('downscaleImage', () => {
  it('draws a big photo at a long side of 2000 as JPEG under the ceiling', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve(bitmap(4000, 3000))))
    const photo = blobOf(6 * 1024 * 1024, 'image/jpeg')

    const out = await downscaleImage(photo)

    expect(out.type).toBe('image/jpeg')
    expect(out.size).toBeLessThanOrEqual(MAX_TIMETABLE_IMAGE_BYTES)
    expect(encoded[0]).toEqual({ width: 2000, height: 1500, quality: 0.85 })
    expect(closed).toBe(1)
  })

  it('keeps a tall photo upright: the long side is the height', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve(bitmap(3000, 6000))))

    await downscaleImage(blobOf(5 * 1024 * 1024, 'image/png'))

    expect(encoded[0]).toMatchObject({ width: 1000, height: 2000 })
  })

  it('uploads a small enough image as it is, without drawing it', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve(bitmap(1200, 900))))
    const photo = blobOf(400_000, 'image/png')

    const out = await downscaleImage(photo)

    expect(out).toBe(photo)
    expect(encoded).toEqual([])
  })

  it('redraws an image within the side but over the bytes', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve(bitmap(1800, 1200))))

    const out = await downscaleImage(blobOf(1_000_000, 'image/png'), { maxBytes: 900_000 })

    expect(encoded[0]).toEqual({ width: 1800, height: 1200, quality: 0.85 })
    expect(out.size).toBeLessThanOrEqual(900_000)
  })

  it('lowers the quality 0.85 → 0.7 → 0.55 before it lowers the size', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve(bitmap(4000, 3000))))
    // 2000×1500 = 3,000,000 pixels: 0.85 → 2.55 MB, 0.7 → 2.1 MB, 0.55 → 1.65 MB.
    bytesPerPixel = 1

    const out = await downscaleImage(blobOf(8_000_000, 'image/jpeg'), { maxBytes: 1_700_000 })

    expect(encoded.map((e) => e.quality)).toEqual([0.85, 0.7, 0.55])
    expect(encoded.every((e) => e.width === 2000)).toBe(true)
    expect(out.size).toBe(1_650_000)
  })

  it('then draws it smaller until it fits', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve(bitmap(4000, 3000))))
    bytesPerPixel = 1

    const out = await downscaleImage(blobOf(8_000_000, 'image/jpeg'), { maxBytes: 1_000_000 })

    expect(out.size).toBeLessThanOrEqual(1_000_000)
    const widths = [...new Set(encoded.map((e) => e.width))]
    expect(widths[0]).toBe(2000)
    expect(widths.length).toBeGreaterThan(1)
    expect(widths.every((w, i) => i === 0 || w < (widths[i - 1] ?? Infinity))).toBe(true)
  })

  it('gives up with file_too_large when even a small drawing does not fit', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve(bitmap(4000, 3000))))

    await expect(downscaleImage(blobOf(8_000_000, 'image/jpeg'), { maxBytes: 10 })).rejects.toMatchObject({
      name: 'UploadError',
      code: 'file_too_large',
    })
    expect(closed).toBe(1)
  })

  it('fails with image_unreadable when the browser cannot open the image', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.reject(new DOMException('bad', 'InvalidStateError'))))

    await expect(downscaleImage(blobOf(100, 'image/jpeg'))).rejects.toMatchObject({ code: 'image_unreadable' })
  })

  it('uses a document canvas when there is no OffscreenCanvas', async () => {
    vi.stubGlobal('OffscreenCanvas', undefined)
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve(bitmap(4000, 2000))))
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage,
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      _type?: string,
      quality?: number,
    ) {
      callback(fakeBlob(this.width, this.height, quality ?? 1))
    })

    const out = await downscaleImage(blobOf(5 * 1024 * 1024, 'image/jpeg'))

    expect(drawImage).toHaveBeenCalledOnce()
    expect(encoded[0]).toEqual({ width: 2000, height: 1000, quality: 0.85 })
    expect(out.type).toBe('image/jpeg')
  })

  it('uploads the file as it is when the browser cannot decode images here, if it fits', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    const photo = blobOf(1000, 'image/png')

    expect(await downscaleImage(photo)).toBe(photo)
    await expect(downscaleImage(blobOf(MAX_TIMETABLE_IMAGE_BYTES + 1, 'image/png'))).rejects.toMatchObject({
      code: 'file_too_large',
    })
  })
})
