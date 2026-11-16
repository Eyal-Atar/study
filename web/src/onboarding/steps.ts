// The onboarding steps, in order. The step lives in the URL (S13 decision 2), so a refresh or a return
// to the phone continues where the student was; the data itself is on the server.
export const STEP_PATHS = {
  exams: '/onboarding/exams',
  materials: '/onboarding/materials',
  schedule: '/onboarding/schedule',
  building: '/onboarding/building',
} as const

export const STEP_COUNT = 4
