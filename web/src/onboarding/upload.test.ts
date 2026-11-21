import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { createFakeApi, problem } from '../test/fakeApi'
import { createFakeStorage } from '../test/fakeStorage'
import { guessKind, MAX_MATERIAL_BYTES, newMaterialId, storeObject, uploadMaterial, UploadError } from './upload'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function fileOf(name: string, type: string, size = 10): File {
  return new File([new Uint8Array(size)], name, { type })
}

function setup() {
  const storage = createFakeStorage()
  const fake = createFakeApi().on({ method: 'POST', path: /^\/exams\/e1\/materials$/ }, (call: { body: unknown }) => ({
    material: { ...(call.body as object), exam_id: 'e1', ingest_status: 'queued' },
    job_id: 'j1',
  }))
  return { storage, fake }
}

const ID = '0b6f1c2e-6a57-4c43-9b1e-6d2f8a4e5c11'

describe('newMaterialId', () => {
  it('is a v4 UUID', () => {
    expect(newMaterialId()).toMatch(UUID)
  })
})

describe('uploadMaterial', () => {
  it('uploads to {user}/{exam}/{id} without upsert, then registers the same id', async () => {
    const { storage, fake } = setup()
    const file = fileOf('מבחן 2024.pdf', 'application/pdf', 1234)
    const id = ID

    const result = await uploadMaterial({ storage: storage.client, api: fake.api, userId: 'u1', examId: 'e1', id, file, kind: 'past_exam' })

    expect(storage.upload).toHaveBeenCalledOnce()
    const [path, body, options] = storage.upload.mock.calls[0] ?? []
    expect(path).toBe(`u1/e1/${id}`)
    expect(body).toBe(file)
    expect(options).toEqual({ contentType: 'application/pdf', upsert: false })
    expect(fake.calls('POST', '/exams/e1/materials').map((c) => c.body)).toEqual([
      { id, filename: 'מבחן 2024.pdf', kind: 'past_exam', mime: 'application/pdf', size_bytes: 1234 },
    ])
    expect(result?.job_id).toBe('j1')
    expect(result?.material.id).toBe(id)
  })

  it('takes the mime from the extension when the browser gives none', async () => {
    const { storage, fake } = setup()
    await uploadMaterial({ storage: storage.client, api: fake.api, userId: 'u1', examId: 'e1', id: ID, file: fileOf('scan.JPG', ''), kind: 'notes' })

    expect(storage.upload.mock.calls[0]?.[2]).toEqual({ contentType: 'image/jpeg', upsert: false })
    expect(fake.calls('POST')[0]?.body).toMatchObject({ mime: 'image/jpeg' })
  })

  it('rejects an unsupported file without the network', async () => {
    const { storage, fake } = setup()
    const file = fileOf('summary.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')

    const error: unknown = await uploadMaterial({ storage: storage.client, api: fake.api, userId: 'u1', examId: 'e1', id: ID, file, kind: 'summary' }).catch(
      (e: unknown) => e,
    )

    expect(error).toBeInstanceOf(UploadError)
    expect((error as UploadError).code).toBe('unsupported_file')
    expect(storage.upload).not.toHaveBeenCalled()
    expect(fake.calls()).toEqual([])
  })

  it('rejects a file over 20 MiB without the network', async () => {
    const { storage, fake } = setup()
    const file = fileOf('big.pdf', 'application/pdf', 21 * 1024 * 1024)

    await expect(
      uploadMaterial({ storage: storage.client, api: fake.api, userId: 'u1', examId: 'e1', id: ID, file, kind: 'past_exam' }),
    ).rejects.toMatchObject({ name: 'UploadError', code: 'file_too_large' })
    expect(storage.upload).not.toHaveBeenCalled()
    expect(fake.calls()).toEqual([])
  })

  it('accepts a file of exactly 20 MiB', async () => {
    const { storage, fake } = setup()
    const file = fileOf('edge.png', 'image/png', MAX_MATERIAL_BYTES)
    await uploadMaterial({ storage: storage.client, api: fake.api, userId: 'u1', examId: 'e1', id: ID, file, kind: 'other' })
    expect(storage.upload).toHaveBeenCalledOnce()
  })

  it('sends no register when the storage upload fails', async () => {
    const { storage, fake } = setup()
    storage.upload.mockResolvedValue({ error: new Error('boom') })

    await expect(
      uploadMaterial({ storage: storage.client, api: fake.api, userId: 'u1', examId: 'e1', id: ID, file: fileOf('a.pdf', 'application/pdf'), kind: 'past_exam' }),
    ).rejects.toMatchObject({ name: 'UploadError', code: 'storage_unavailable' })
    expect(fake.calls()).toEqual([])
  })

  it('treats a storage upload that throws as storage_unavailable', async () => {
    const { storage, fake } = setup()
    storage.upload.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(
      uploadMaterial({ storage: storage.client, api: fake.api, userId: 'u1', examId: 'e1', id: ID, file: fileOf('a.pdf', 'application/pdf'), kind: 'past_exam' }),
    ).rejects.toMatchObject({ code: 'storage_unavailable' })
    expect(fake.calls()).toEqual([])
  })

  it('lets a register failure through as the ApiError', async () => {
    const { storage, fake } = setup()
    fake.on('POST /exams/e1/materials', problem(409, 'too_many_materials'))

    const error: unknown = await uploadMaterial({
      storage: storage.client,
      api: fake.api,
      userId: 'u1',
      examId: 'e1',
      id: ID,
      file: fileOf('a.pdf', 'application/pdf'),
      kind: 'past_exam',
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('too_many_materials')
  })
  it('sends only the register, with the same id, when the file is already in Storage', async () => {
    const { storage, fake } = setup()

    const result = await uploadMaterial({
      storage: storage.client,
      api: fake.api,
      userId: 'u1',
      examId: 'e1',
      id: ID,
      file: fileOf('a.pdf', 'application/pdf'),
      kind: 'past_exam',
      stored: true,
    })

    expect(storage.upload).not.toHaveBeenCalled()
    expect(fake.calls('POST', '/exams/e1/materials').map((c) => (c.body as { id: string }).id)).toEqual([ID])
    expect(result?.material.id).toBe(ID)
  })

  it('counts already_exists on a register retry as registered (the first answer was lost)', async () => {
    const { storage, fake } = setup()
    fake.on('POST /exams/e1/materials', problem(409, 'already_exists'))

    const result = await uploadMaterial({
      storage: storage.client,
      api: fake.api,
      userId: 'u1',
      examId: 'e1',
      id: ID,
      file: fileOf('a.pdf', 'application/pdf'),
      kind: 'past_exam',
      stored: true,
    })

    expect(result).toBeNull()
  })

  it('lets already_exists through on a first register (the id is not ours)', async () => {
    const { storage, fake } = setup()
    fake.on('POST /exams/e1/materials', problem(409, 'already_exists'))

    await expect(
      uploadMaterial({ storage: storage.client, api: fake.api, userId: 'u1', examId: 'e1', id: ID, file: fileOf('a.pdf', 'application/pdf'), kind: 'past_exam' }),
    ).rejects.toMatchObject({ name: 'ApiError', code: 'already_exists' })
  })

  it('treats "the object already exists" in Storage as uploaded (an earlier try of the same id got there)', async () => {
    const { storage, fake } = setup()
    storage.upload.mockResolvedValue({ error: Object.assign(new Error('The resource already exists'), { statusCode: '409' }) })

    const result = await uploadMaterial({
      storage: storage.client,
      api: fake.api,
      userId: 'u1',
      examId: 'e1',
      id: ID,
      file: fileOf('a.pdf', 'application/pdf'),
      kind: 'past_exam',
    })

    expect(fake.calls('POST', '/exams/e1/materials')).toHaveLength(1)
    expect(result?.material.id).toBe(ID)
  })
})

describe('storeObject', () => {
  it('puts the blob at the path without upsert', async () => {
    const storage = createFakeStorage()
    const blob = new Blob([new Uint8Array(3)], { type: 'image/jpeg' })

    await storeObject(storage.client, 'u1/timetables/t1', blob, 'image/jpeg')

    expect(storage.upload).toHaveBeenCalledWith('u1/timetables/t1', blob, { contentType: 'image/jpeg', upsert: false })
  })

  it('turns a failure into storage_unavailable, and an existing object into success', async () => {
    const storage = createFakeStorage()
    storage.upload.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(storeObject(storage.client, 'p', new Blob([]), 'application/pdf')).rejects.toMatchObject({
      name: 'UploadError',
      code: 'storage_unavailable',
    })

    storage.upload.mockResolvedValueOnce({ error: Object.assign(new Error('exists'), { statusCode: '409' }) })
    await expect(storeObject(storage.client, 'p', new Blob([]), 'application/pdf')).resolves.toBeUndefined()
  })
})

describe('guessKind', () => {
  it.each([
    ['פתרון מבחן 2023.pdf', 'solution'],
    ['Exam_SOLUTION.pdf', 'solution'],
    ['סילבוס.pdf', 'syllabus'],
    ['Syllabus 2026.pdf', 'syllabus'],
    ['סיכום הרצאות.pdf', 'summary'],
    ['course-Summary.png', 'summary'],
    ['מועד א 2024.pdf', 'past_exam'],
    ['scan.jpg', 'past_exam'],
  ] as const)('%s → %s', (name, kind) => {
    expect(guessKind(name)).toBe(kind)
  })
})
