import { createContext, useContext } from 'react'

// The bucket the web uploads materials into, under {user_id}/{exam_id}/{material_id} (design doc 7.7).
export const MATERIALS_BUCKET = 'materials'

// The one Storage call the app makes, in the narrow types it needs. The real bucket
// (supabase.storage.from('materials')) satisfies it without a cast, and tests pass a fake.
export interface StorageClient {
  // upsert is always false: a material id names one file, and an existing object is never replaced.
  upload(path: string, file: Blob, options: { contentType: string; upsert: false }): Promise<{ error: Error | null }>
}

// Only what createStorage reads of the Supabase client, so a test can pass a small fake.
export interface StorageSource {
  storage: { from(bucket: string): StorageClient }
}

export function createStorage(supabase: StorageSource): StorageClient {
  return supabase.storage.from(MATERIALS_BUCKET)
}

export const StorageContext = createContext<StorageClient | null>(null)

export function useStorage(): StorageClient {
  const value = useContext(StorageContext)
  if (value === null) {
    throw new Error('useStorage() must be used inside <AppProviders>')
  }
  return value
}
