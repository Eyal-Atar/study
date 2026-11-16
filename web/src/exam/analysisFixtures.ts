import type { Job } from '../onboarding/types'
import type { AnalysisApply, ExamTaskItem, ExamTopics, ReanalyzeResult } from './analysis'

// Test data for the analysis and materials sections (only tests import this file).

export function taskItem(overrides: Partial<ExamTaskItem> = {}): ExamTaskItem {
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
    topic_id: null,
    material_id: null,
    position: 1,
    reason: null,
    ...overrides,
  }
}

export function topicsFixture(overrides: Partial<ExamTopics> = {}): ExamTopics {
  return { analysis_id: null, draft_analysis_id: null, topics: [], gaps: [], ...overrides }
}

export function applyFixture(overrides: Partial<AnalysisApply> = {}): AnalysisApply {
  return {
    basis: 'b1',
    version_id: null,
    replaced: [],
    kept: 0,
    added: [],
    added_blocks: [],
    removed_blocks: [],
    unscheduled: [],
    shortfalls: [],
    ...overrides,
  }
}

export function reanalyzeJob(overrides: Partial<Job<ReanalyzeResult>> = {}): Job<ReanalyzeResult> {
  return {
    id: 'j2',
    kind: 'reanalyze_exam',
    status: 'running',
    stage: null,
    percent: null,
    error: null,
    result: null,
    created_at: '2026-11-16T08:00:00Z',
    started_at: '2026-11-16T08:00:01Z',
    finished_at: null,
    ...overrides,
  }
}

export function reanalyzeResult(analysisId: string): ReanalyzeResult {
  return {
    analysis_id: analysisId,
    exam_id: 'e1',
    tasks: 3,
    topics: 2,
    gaps: [],
    warnings: [],
    dropped: [],
    total_minutes: 180,
    budget_minutes: 600,
  }
}
