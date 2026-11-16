import type { SupabaseClient } from '@supabase/supabase-js'
import { expect, expectTypeOf, it, vi } from 'vitest'
import { createStorage, type StorageClient } from './storage'
import type { createSupabase } from './supabase'

it('accepts the real materials bucket as a StorageClient, without a cast', () => {
  type Bucket = ReturnType<ReturnType<typeof createSupabase>['storage']['from']>
  expectTypeOf<Bucket>().toExtend<StorageClient>()
  expectTypeOf<ReturnType<SupabaseClient['storage']['from']>>().toExtend<StorageClient>()
})

it('uploads into the materials bucket', async () => {
  const upload = vi.fn(() => Promise.resolve({ data: { path: 'p' }, error: null }))
  const from = vi.fn(() => ({ upload }))
  const storage = createStorage({ storage: { from } })
  const file = new Blob(['x'])

  await expect(storage.upload('u/e/id', file, { contentType: 'application/pdf', upsert: false })).resolves.toEqual({
    data: { path: 'p' },
    error: null,
  })
  expect(from).toHaveBeenCalledWith('materials')
  expect(upload).toHaveBeenCalledWith('u/e/id', file, { contentType: 'application/pdf', upsert: false })
})
