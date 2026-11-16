// The generate_plan job of the onboarding, remembered per user in sessionStorage, so a student who
// comes back while it still runs (to / or /onboarding) lands on its building screen and not on step 1.
// Storage may be unavailable (private mode, blocked site data): every access is wrapped, and without
// it the gate simply sends the student to the first step as before.

const key = (userId: string) => `studyflow:onboarding-job:${userId}`

export function rememberJob(userId: string | null, jobId: string): void {
  if (userId === null) return
  try {
    sessionStorage.setItem(key(userId), jobId)
  } catch {
    // Not remembered: the next visit starts at the first step.
  }
}

export function rememberedJob(userId: string | null): string | null {
  if (userId === null) return null
  try {
    return sessionStorage.getItem(key(userId))
  } catch {
    return null
  }
}

export function forgetJob(userId: string | null): void {
  if (userId === null) return
  try {
    sessionStorage.removeItem(key(userId))
  } catch {
    // Nothing to forget.
  }
}
