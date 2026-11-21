// Material deletes the screen has promised but the server has not done yet (S13, "why a material delete
// waits"): waiting for their undo toast to expire, or already sent. The materials step flushes them before
// it leaves, so the next steps (and the plan's analysis) never see a file the user deleted.
// Module-level and not a context: there is one onboarding per tab, and the step that waits for the deletes
// is not the component that started them.

// Material id → closes its undo toast, which sends the DELETE (the toast's onExpire).
const waiting = new Map<string, () => void>()
// DELETEs on their way; each resolves true when the server deleted the file.
const sending = new Set<Promise<boolean>>()

// A delete hidden behind its undo toast. `close` closes that toast.
export function waitToDelete(materialId: string, close: () => void): void {
  waiting.set(materialId, close)
}

// "Undo": the delete will not happen.
export function cancelDelete(materialId: string): void {
  waiting.delete(materialId)
}

// The toast expired: the DELETE is sent. `run` resolves false when it failed (and has shown that).
export function sendDelete(materialId: string, run: () => Promise<boolean>): void {
  waiting.delete(materialId)
  const sent: Promise<boolean> = run()
    .catch(() => false)
    .finally(() => {
      sending.delete(sent)
    })
  sending.add(sent)
}

// Sends every waiting delete now and waits for all of them. False when any failed: the file is back on
// screen, so the user should stay where they can see it.
export async function flushDeletes(): Promise<boolean> {
  for (const [materialId, close] of [...waiting]) {
    waiting.delete(materialId)
    close()
  }
  const results = await Promise.all([...sending])
  return results.every(Boolean)
}
