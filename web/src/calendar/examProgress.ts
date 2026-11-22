import { useQueries } from '@tanstack/react-query'
import { useApi } from '../api/ApiContext'
import { useUserId } from '../api/me'
import { tasksKey } from '../exam/api'
import { examProgress } from '../exam/examProgress'
import type { ExamTask } from '../exam/types'

// The progress of each exam by the one formula of the exams screen (exam/examProgress.ts, S34
// decision 11). The query is the one of useExamTasks (same key, same function), so the cache is
// shared with the exam screen.
export function useExamProgress(examIds: string[]): Map<string, ReturnType<typeof examProgress>> {
  const api = useApi()
  const userId = useUserId()
  return useQueries({
    queries: examIds.map((examId) => ({
      queryKey: tasksKey(userId, examId),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<ExamTask[]>(`/exams/${examId}/tasks`, { signal }),
      enabled: userId !== null,
    })),
    combine: (results) => {
      const map = new Map<string, ReturnType<typeof examProgress>>()
      results.forEach((result, i) => {
        const id = examIds[i]
        if (id === undefined || result.data === undefined) return
        map.set(id, examProgress(result.data))
      })
      return map
    },
  })
}
