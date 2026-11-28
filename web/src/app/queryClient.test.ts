import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { createQueryClient, shouldRetry } from './queryClient'

describe('shouldRetry', () => {
  it('never retries a 4xx', () => {
    expect(shouldRetry(0, new ApiError(401, 'unauthenticated', null))).toBe(false)
    expect(shouldRetry(0, new ApiError(422, 'invalid', null))).toBe(false)
  })

  it('retries a 5xx or a missing response, up to twice', () => {
    expect(shouldRetry(0, new ApiError(503, 'auth_unavailable', null))).toBe(true)
    expect(shouldRetry(1, new ApiError(0, 'network', null))).toBe(true)
    expect(shouldRetry(2, new ApiError(503, 'auth_unavailable', null))).toBe(false)
  })
})

describe('createQueryClient', () => {
  it('a mutation without a network fails now instead of waiting', () => {
    expect(createQueryClient().getDefaultOptions().mutations?.networkMode).toBe('always')
  })

  it('keeps the query retry rule', () => {
    expect(createQueryClient().getDefaultOptions().queries?.retry).toBe(shouldRetry)
  })
})
