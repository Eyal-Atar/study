import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { expect, expectTypeOf, it, vi } from 'vitest'
import { createSupabase, type AuthClient } from './supabase'

vi.mock('@supabase/supabase-js')

const env = {
  supabaseUrl: 'https://test-ref.supabase.co',
  supabasePublishableKey: 'sb_publishable_abc123',
  apiUrl: 'http://localhost:8000',
}

it('creates the client with the PKCE flow', () => {
  createSupabase(env)
  expect(vi.mocked(createClient)).toHaveBeenCalledOnce()
  expect(vi.mocked(createClient).mock.calls[0]).toMatchObject([
    'https://test-ref.supabase.co',
    'sb_publishable_abc123',
    { auth: { flowType: 'pkce' }, global: { fetch: expect.any(Function) as unknown } },
  ])
})

it('accepts the real supabase.auth as an AuthClient, without a cast', () => {
  expectTypeOf<ReturnType<typeof createSupabase>['auth']>().toExtend<AuthClient>()
  expectTypeOf<SupabaseClient['auth']>().toExtend<AuthClient>()
})
