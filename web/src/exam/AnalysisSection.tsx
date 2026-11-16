// S15 stub (Task 0): Task 7 builds it. The exam screen (Task 6) renders it with the exam's id.
export interface AnalysisSectionProps {
  examId: string
}

export function AnalysisSection(props: AnalysisSectionProps) {
  return props.examId === '' ? null : null
}
