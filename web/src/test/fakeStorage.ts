import { vi, type Mock } from 'vitest'
import type { StorageClient } from '../auth/storage'

export interface FakeStorage {
  client: StorageClient
  upload: Mock<StorageClient['upload']>
}

// A StorageClient without a network: every upload succeeds, unless a test changes `upload`.
export function createFakeStorage(): FakeStorage {
  const upload = vi.fn<StorageClient['upload']>(() => Promise.resolve({ error: null }))
  return { client: { upload }, upload }
}
