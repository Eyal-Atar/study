import { describe, expect, it, vi } from 'vitest'
import { createFakeApi } from '../test/fakeApi'
import { createFakeStorage } from '../test/fakeStorage'
import { MAX_TIMETABLE_IMAGE_BYTES } from './downscale'
import { MAX_TIMETABLE_PDF_BYTES, timetableFileProblem, timetablePath, uploadTimetable } from './timetableUpload'

vi.mock('./downscale', async (original) => {
  const actual = await original<typeof import('./downscale')>()
  return {
    ...actual,
    downscaleImage: vi.fn(() => Promise.resolve(new Blob([new Uint8Array(500)], { type: 'image/jpeg' }))),
  }
})

const ID = '0b6f1c2e-6a57-4c43-9b1e-6d2f8a4e5c11'

function fileOf(name: string, type: string, size = 10): File {
  return new File([new Uint8Array(size)], name, { type })
}

function register() {
  const fake = createFakeApi().on('POST /timetables', { job_id: 'j1' })
  return { fake, register: (body: unknown) => fake.api.post<{ job_id: string }>('/timetables', body) }
}

describe('timetableFileProblem', () => {
  it.each([
    ['מערכת.jpg', 'image/jpeg', 10, null],
    ['מערכת.png', 'image/png', 10, null],
    ['מערכת.pdf', 'application/pdf', 10, null],
    ['scan.JPG', '', 10, null],
    ['IMG_0001.heic', 'image/heic', 10, 'unsupported_file'],
    ['מערכת.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 10, 'unsupported_file'],
    ['big.pdf', 'application/pdf', MAX_TIMETABLE_PDF_BYTES + 1, 'file_too_large'],
    ['edge.pdf', 'application/pdf', MAX_TIMETABLE_PDF_BYTES, null],
    // An image is made smaller before the upload, so its size is not a problem yet.
    ['huge.jpg', 'image/jpeg', MAX_TIMETABLE_IMAGE_BYTES * 3, null],
  ])('%s (%s, %d bytes) → %s', (name, type, size, expected) => {
    expect(timetableFileProblem({ name, type, size })).toBe(expected)
  })
})

describe('uploadTimetable', () => {
  it('uploads a PDF as it is to {user}/timetables/{id}, then registers it', async () => {
    const storage = createFakeStorage()
    const { fake, register: post } = register()
    const file = fileOf('מערכת.pdf', 'application/pdf', 1234)

    const result = await uploadTimetable({ storage: storage.client, userId: 'u1', id: ID, file, register: post })

    expect(timetablePath('u1', ID)).toBe(`u1/timetables/${ID}`)
    expect(storage.upload).toHaveBeenCalledWith(`u1/timetables/${ID}`, file, { contentType: 'application/pdf', upsert: false })
    expect(fake.calls('POST', '/timetables').map((c) => c.body)).toEqual([{ id: ID, mime: 'application/pdf', size_bytes: 1234 }])
    expect(result).toEqual({ job_id: 'j1' })
  })

  it('uploads the smaller JPEG of a photo, with its own mime and size', async () => {
    const storage = createFakeStorage()
    const { fake, register: post } = register()

    await uploadTimetable({ storage: storage.client, userId: 'u1', id: ID, file: fileOf('מערכת.png', 'image/png', 9_000_000), register: post })

    const [, body, options] = storage.upload.mock.calls[0] ?? []
    expect((body as Blob).size).toBe(500)
    expect(options).toEqual({ contentType: 'image/jpeg', upsert: false })
    expect(fake.calls('POST', '/timetables')[0]?.body).toEqual({ id: ID, mime: 'image/jpeg', size_bytes: 500 })
  })

  it('refuses a file of another kind before any request', async () => {
    const storage = createFakeStorage()
    const { fake, register: post } = register()

    await expect(
      uploadTimetable({ storage: storage.client, userId: 'u1', id: ID, file: fileOf('IMG.heic', 'image/heic'), register: post }),
    ).rejects.toMatchObject({ name: 'UploadError', code: 'unsupported_file' })
    expect(storage.upload).not.toHaveBeenCalled()
    expect(fake.calls()).toEqual([])
  })

  it('refuses a PDF over the limit before any request', async () => {
    const storage = createFakeStorage()
    const { fake, register: post } = register()

    await expect(
      uploadTimetable({
        storage: storage.client,
        userId: 'u1',
        id: ID,
        file: fileOf('big.pdf', 'application/pdf', MAX_TIMETABLE_PDF_BYTES + 1),
        register: post,
      }),
    ).rejects.toMatchObject({ code: 'file_too_large' })
    expect(storage.upload).not.toHaveBeenCalled()
    expect(fake.calls()).toEqual([])
  })

  it('sends no register when Storage fails', async () => {
    const storage = createFakeStorage()
    storage.upload.mockResolvedValue({ error: new Error('boom') })
    const { fake, register: post } = register()

    await expect(
      uploadTimetable({ storage: storage.client, userId: 'u1', id: ID, file: fileOf('a.pdf', 'application/pdf'), register: post }),
    ).rejects.toMatchObject({ code: 'storage_unavailable' })
    expect(fake.calls()).toEqual([])
  })
})
