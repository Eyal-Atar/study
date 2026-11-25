import { useCallback, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router'
import { useBoardUserId } from '../board/api'
import { blockMinutes } from '../board/time'
import type { Block } from '../board/types'
import { breakRun } from '../calendar/archi'

// The focus session (S42): its rules, its clock from wall time, its storage on the device, and a small
// store. Everything but the two hooks is pure and takes `now`.

export const FOCUS_PATH = '/focus'
export const FIVE_MINUTES_MS = 300_000
export const SESSION_MAX_AGE_MS = 43_200_000

const MINUTE = 60_000

export type FocusMode = 'full' | 'five'

export interface FocusSession {
  v: 1
  blockId: string
  startedAt: number
  endsAt: number
  fiveEndsAt: number | null
}

export type FocusPhase = 'five' | 'full' | 'over'

export interface FocusClock {
  phase: FocusPhase
  // To the end of the phase: fiveEndsAt in 'five', endsAt in 'full', 0 in 'over'.
  phaseLeftMs: number
  elapsedMs: number // now - startedAt, clipped to 0..totalMs
  totalMs: number // endsAt - startedAt
  // When the shown minute or the phase changes next; null in 'over'.
  nextChangeAt: number | null
}

export function focusPath(blockId: string): string {
  return `${FOCUS_PATH}/${encodeURIComponent(blockId)}`
}

// By the clock, not by `state`: a block that has not started, or runs now.
export function canFocus(block: Block, today: string, now: number): boolean {
  return block.status === 'planned' && block.study_date === today && Date.parse(block.ends_at) > now
}

function endsAtFor(block: Block, now: number): number {
  const running = Date.parse(block.starts_at) <= now
  return running ? Date.parse(block.ends_at) : now + blockMinutes(block) * MINUTE
}

export function canStartFive(block: Block, now: number): boolean {
  return endsAtFor(block, now) - now > FIVE_MINUTES_MS
}

export function newSession(block: Block, mode: FocusMode, now: number): FocusSession {
  const endsAt = endsAtFor(block, now)
  return {
    v: 1,
    blockId: block.id,
    startedAt: now,
    endsAt,
    fiveEndsAt: mode === 'five' ? Math.min(now + FIVE_MINUTES_MS, endsAt) : null,
  }
}

export function minutesLeft(ms: number): number {
  return ms <= 0 ? 0 : Math.ceil(ms / MINUTE)
}

export function focusClock(session: FocusSession, now: number): FocusClock {
  const totalMs = session.endsAt - session.startedAt
  const elapsedMs = Math.min(Math.max(now - session.startedAt, 0), totalMs)
  if (now >= session.endsAt) {
    return {
      phase: 'over',
      phaseLeftMs: 0,
      elapsedMs,
      totalMs,
      nextChangeAt: null,
    }
  }
  const five = session.fiveEndsAt !== null && now < session.fiveEndsAt
  const end = five ? (session.fiveEndsAt as number) : session.endsAt
  const left = end - now
  return {
    phase: five ? 'five' : 'full',
    phaseLeftMs: left,
    elapsedMs,
    totalMs,
    nextChangeAt: end - (minutesLeft(left) - 1) * MINUTE,
  }
}

export function isLive(session: FocusSession | null, blockId: string, now: number): boolean {
  return session !== null && session.blockId === blockId && focusClock(session, now).phase !== 'over'
}

// Would marking this block done close a run of study that earns a break? The block counts with the
// times the student really studied, not the planned ones.
export function breakAfterFocus(todayBlocks: Block[], block: Block, session: FocusSession, now: number): boolean {
  const finished: Block = {
    ...block,
    status: 'done',
    state: 'done',
    starts_at: new Date(session.startedAt).toISOString(),
    ends_at: new Date(now).toISOString(),
  }
  const has = todayBlocks.some((b) => b.id === block.id)
  const blocks = has ? todayBlocks.map((b) => (b.id === block.id ? finished : b)) : [...todayBlocks, finished]
  return breakRun(blocks, now) !== null
}

// Storage

export function focusStorageKey(userId: string): string {
  return `archi.focus.${userId}`
}

function defaultStorage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

// null for anything that is not a valid session; no expiry check here.
function parseSession(raw: string): FocusSession | null {
  try {
    const o: unknown = JSON.parse(raw)
    if (typeof o !== 'object' || o === null) return null
    const r = o as Record<string, unknown>
    if (r.v !== 1 || typeof r.blockId !== 'string') return null
    if (typeof r.startedAt !== 'number' || typeof r.endsAt !== 'number') return null
    if (r.fiveEndsAt !== null && typeof r.fiveEndsAt !== 'number') return null
    return {
      v: 1,
      blockId: r.blockId,
      startedAt: r.startedAt,
      endsAt: r.endsAt,
      fiveEndsAt: r.fiveEndsAt,
    }
  } catch {
    return null
  }
}

function expired(s: FocusSession, now: number): boolean {
  return now - s.endsAt > SESSION_MAX_AGE_MS
}

export function readSession(
  userId: string,
  now: number,
  storage: Pick<Storage, 'getItem' | 'removeItem'> | undefined = defaultStorage(),
): FocusSession | null {
  if (!storage) return null
  const key = focusStorageKey(userId)
  try {
    const raw = storage.getItem(key)
    if (raw === null) return null
    const s = parseSession(raw)
    if (s && !expired(s, now)) return s
    storage.removeItem(key)
    return null
  } catch {
    return null
  }
}

// When storage throws, the last written session of each user lives here until a refresh.
const memory = new Map<string, FocusSession>()
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((l) => {
    l()
  })
}

export function writeSession(
  userId: string,
  session: FocusSession,
  storage: Pick<Storage, 'setItem'> | undefined = defaultStorage(),
): void {
  try {
    if (!storage) throw new Error('no storage')
    storage.setItem(focusStorageKey(userId), JSON.stringify(session))
    memory.delete(userId)
  } catch {
    memory.set(userId, session)
  }
  notify()
}

export function clearSession(
  userId: string,
  storage: Pick<Storage, 'removeItem'> | undefined = defaultStorage(),
): void {
  memory.delete(userId)
  try {
    storage?.removeItem(focusStorageKey(userId))
  } catch {
    // Nothing to clear that we could reach.
  }
  notify()
}

// Store

// One parsed object per raw string, so useSyncExternalStore sees a stable snapshot.
const parsed = new Map<string, { raw: string; session: FocusSession | null }>()

function snapshotOf(userId: string): FocusSession | null {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(focusStorageKey(userId))
  } catch {
    return memory.get(userId) ?? null
  }
  if (raw === null) return memory.get(userId) ?? null
  const hit = parsed.get(userId)
  if (hit && hit.raw === raw) return hit.session
  const s = parseSession(raw)
  const session = s && !expired(s, Date.now()) ? s : null
  parsed.set(userId, { raw, session })
  return session
}

function current(userId: string, now: number): FocusSession | null {
  return readSession(userId, now) ?? memory.get(userId) ?? null
}

export function useFocusSession(): FocusSession | null {
  const userId = useBoardUserId()
  const subscribe = useCallback(
    (onChange: () => void) => {
      listeners.add(onChange)
      const onStorage = (e: StorageEvent) => {
        if (userId !== null && (e.key === focusStorageKey(userId) || e.key === null)) onChange()
      }
      window.addEventListener('storage', onStorage)
      return () => {
        listeners.delete(onChange)
        window.removeEventListener('storage', onStorage)
      }
    },
    [userId],
  )
  const getSnapshot = useCallback(() => (userId === null ? null : snapshotOf(userId)), [userId])
  return useSyncExternalStore(subscribe, getSnapshot, () => null)
}

export function useStartFocus(): (block: Block, mode: FocusMode) => void {
  const userId = useBoardUserId()
  const navigate = useNavigate()
  return useCallback(
    (block, mode) => {
      const now = Date.now()
      if (userId !== null) {
        // "Back to focus" sends 'full' for a session that still runs: go back, do not restart it.
        const keep = mode === 'full' && isLive(current(userId, now), block.id, now)
        if (!keep) writeSession(userId, newSession(block, mode, now))
      }
      void navigate(focusPath(block.id))
    },
    [userId, navigate],
  )
}
