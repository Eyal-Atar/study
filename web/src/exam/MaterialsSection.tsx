// S15 stub (Task 0): Task 7 builds it. The exam screen (Task 6) renders it with the exam's id.
export interface MaterialsSectionProps {
  examId: string
}

export function MaterialsSection(props: MaterialsSectionProps) {
  return props.examId === '' ? null : null
}
