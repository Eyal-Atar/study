import { BROWSER_ZONE, COMPLETED_AT, examFixture, meFixture, previewFixture } from '../onboarding/testFixtures'
import type { Block, Exam } from '../onboarding/types'
import { createFakeApi, type FakeApi } from './fakeApi'
import { createFakeAuth, fakeSession } from './fakeAuth'
import { renderRoute } from './renderRoute'
import { addDays, todayIn } from '../exam/dates'
import type { ExamTask, PlanResponse, Topic, TopicsResponse } from '../exam/types'

// Shared test data for the exam screen (only tests import this file).

export const TODAY = todayIn(BROWSER_ZONE)

export function taskFixture(overrides: Partial<ExamTask> = {}): ExamTask {
  return {
    id: 't1',
    exam_id: 'e1',
    title: 'גבולות',
    kind: 'learn',
    estimated_minutes: 60,
    focus: 5,
    depends_on_task_id: null,
    status: 'todo',
    source: 'ai',
    created_at: '2026-11-16T08:00:00Z',
    topic_id: 'p1',
    material_id: null,
    position: 1,
    reason: null,
    ...overrides,
  }
}

export function topicFixture(overrides: Partial<Topic> = {}): Topic {
  return { id: 'p1', exam_id: 'e1', name: 'גבולות ורציפות', weight: 4, evidence: null, position: 1, analysis_id: 'a1', ...overrides }
}

export function topicsFixture(overrides: Partial<TopicsResponse> = {}): TopicsResponse {
  return { analysis_id: 'a1', draft_analysis_id: null, topics: [topicFixture()], gaps: [], ...overrides }
}

export function blockFixture(overrides: Partial<Block> = {}): Block {
  return {
    id: 'b1',
    task_id: 't1',
    exam_id: 'e1',
    task_title: 'גבולות',
    task_kind: 'learn',
    exam_name: 'חדו"א',
    starts_at: `${addDays(TODAY, 1)}T08:00:00Z`,
    ends_at: `${addDays(TODAY, 1)}T09:30:00Z`,
    study_date: addDays(TODAY, 1),
    part_index: 0,
    part_count: 1,
    pinned: false,
    status: 'planned',
    state: 'upcoming',
    ...overrides,
  }
}

export function planFixture(blocks: Block[] = [], overrides: Partial<PlanResponse> = {}): PlanResponse {
  return { from: TODAY, to: addDays(TODAY, 4), blocks, unplaced: [], undo: null, ...overrides }
}

// The exam of the screen tests: 5 days from today, so the timeline covers it whole.
export const EXAM: Exam = examFixture({ exam_date: addDays(TODAY, 5) })

// A server for a user who finished the onboarding, with one exam and whatever the test adds.
export function examServer({
  exams = [EXAM],
  tasks = [],
  topics = topicsFixture(),
  blocks = [],
}: { exams?: Exam[]; tasks?: ExamTask[]; topics?: TopicsResponse; blocks?: Block[] } = {}): FakeApi {
  return createFakeApi()
    // Wake at 00:00: the study day is the calendar day at any hour the tests run.
    .on('GET /me', meFixture({ onboarding_completed_at: COMPLETED_AT, wake_time: '00:00' }))
    .on('GET /exams', exams)
    .on({ method: 'GET', path: /^\/exams\/[^/]+\/tasks$/ }, tasks)
    .on({ method: 'GET', path: /^\/exams\/[^/]+\/topics$/ }, topics)
    .on({ method: 'GET', path: /^\/exams\/[^/]+\/materials$/ }, [])
    .on({ method: 'GET', path: /^\/plan\?/ }, planFixture(blocks))
    .on('POST /plan/replan', previewFixture())
}

export function openRoute(fake: FakeApi, path: string) {
  return renderRoute(path, { auth: createFakeAuth(fakeSession()), api: fake.api })
}
