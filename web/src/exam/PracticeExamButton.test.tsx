import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en'
import { PracticeExamButton } from './PracticeExamButton'

describe('PracticeExamButton', () => {
  it('is a disabled button with its icon, and says it is coming soon', () => {
    render(<PracticeExamButton />)
    const button = screen.getByRole('button', { name: new RegExp(en.exams.exam.practice.create) })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription(en.exams.exam.practice.soon)
    expect(button.querySelector('svg')).not.toBeNull()
    expect(screen.getByText(en.exams.exam.practice.soon)).toBeVisible()
  })
})
