import { useQueries } from '@tanstack/react-query'
import { useApi } from '../api/ApiContext'
import { useUserId } from '../api/me'
import { tasksKey } from '../exam/api'
import type { ExamTask } from '../exam/types'

// Minutes done out of the minutes of the exam's tasks; a skipped task is not counted. The query is
// the one of useExamTasks (same key, same function), so the cache is shared with the exam screen.
export function useExamProgress(examIds: string[]): Map<string, { done: number; total: number }> {
  const api = useApi()
  const userId = useUserId()
  return useQueries({
    queries: examIds.map((examId) => ({
      queryKey: tasksKey(userId, examId),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<ExamTask[]>(`/exams/${examId}/tasks`, { signal }),
      enabled: userId !== null,
    })),
    combine: (results) => {
      const map = new Map<string, { done: number; total: number }>()
      results.forEach((result, i) => {
        const id = examIds[i]
        if (id === undefined || result.data === undefined) return
        let done = 0
        let total = 0
        for (const task of result.data) {
          if (task.status === 'skipped') continue
          total += task.estimated_minutes
          if (task.status === 'done') done += task.estimated_minutes
        }
        map.set(id, { done, total })
      })
      return map
    },
  })
}
