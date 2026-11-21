import type { QueryClient } from '@tanstack/react-query'

// A plan version is undone once (POST /plan/undo). A second press of the toast's "Undo" (a double
// click, before the toast is gone) would send it again, and the server would answer nothing_to_undo
// after an undo that worked. So a version is claimed while its undo runs and after it succeeded;
// a failure releases it.
//
// The claims hang on the QueryClient, not on a component: the toast's undo outlives the screen that
// started the action, and every hook instance of one app shares its client.

const claims = new WeakMap<QueryClient, Set<string>>()

// Runs `request` unless an undo of this version already runs or succeeded; then returns null.
export function undoOnce<T>(queryClient: QueryClient, versionId: string, request: () => Promise<T>): Promise<T> | null {
  let claimed = claims.get(queryClient)
  if (claimed === undefined) {
    claimed = new Set()
    claims.set(queryClient, claimed)
  }
  if (claimed.has(versionId)) return null
  const set = claimed
  set.add(versionId)
  return request().catch((error: unknown) => {
    set.delete(versionId)
    throw error
  })
}
