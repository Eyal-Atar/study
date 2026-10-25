import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library cleans up by itself only when afterEach is a global, and vitest globals are off.
afterEach(() => {
  cleanup()
})
