status: resolved
root_cause: Missing DB columns for task_title/exam_name and invalid ISO strings with double timezone indicators.
fix: Added columns to schedule_blocks, updated INSERT logic, and standardized scheduler timestamp formatting.
