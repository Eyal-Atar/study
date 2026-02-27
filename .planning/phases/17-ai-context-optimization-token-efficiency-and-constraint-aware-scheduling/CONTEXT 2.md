# Phase 17: AI Context Optimization, Token Efficiency, and Constraint-Aware Scheduling

## Phase Boundary
Redefining the architecture of the AI integration to establish a strict separation of concerns. The AI (ExamBrain) will transition from a chronological timeline generator to a pedagogical strategist (Task Decomposer). The deterministic Python backend (Scheduler) will take absolute control of mathematical time placement, strictly enforcing user settings like wake/sleep times and fixed breaks, ensuring task durations are honored accurately without LLM hallucinations.

## Implementation Decisions

### Separation of Concerns (AI vs. Algorithm)
- **AI as Strategist (exam_brain.py):** The LLM will no longer assign a specific `day_date` to tasks. Its sole responsibility is analyzing syllabus/exam data to output a logically ordered, prioritized list of study tasks (Single Focus, Simulation-First) with explicit `estimated_hours` and `sort_order`.
- **Python as Scheduler (scheduler.py):** The Python logic will act as the absolute source of truth for time constraints. It will ingest the AI's ordered task list and mathematically fit it into the user's available time blocks, navigating around hard constraints (wake up, sleep) and fixed break allocations.

### Token & Payload Optimization
- **Eliminate Redundant Processing:** `exam_brain.py` currently re-reads up to 5000 characters per PDF upon every calendar generation. This will be refactored. Extracted context should be cached or processed once (leveraging `syllabus_parser.py`), meaning the AI only receives a lean array of topics/exam requirements instead of raw PDF text.
- **Lean JSON Output:** The required JSON schema from Claude will be stripped of date logic, dropping the `day_date` requirement to reduce output token consumption and prevent prompt confusion.

### Constraint-Aware Logic
- **Hard Boundaries:** Waking hours and sleep hours are absolute limits. The scheduler will create strict valid time arrays.
- **Task-Driven Allocation:** The time assigned to a task in the schedule will be strictly derived from the AI's `estimated_hours`. `scheduler.py` will chunk these durations dynamically to route around fixed breaks, without expanding or shrinking the total time required for the task.
- **Fixed Breaks Support:** Transitioning from "ghost gaps" to explicit, non-negotiable blocked arrays in the user's day, treating mandatory breaks with the same priority as study blocks.

## Specific Ideas
- **"Decomposition, not Placement":** The prompt in `exam_brain.py` will explicitly forbid the LLM from trying to calculate days or weeks.
- **Dynamic Task Splitting:** If a task requires 3 hours, but a fixed break interrupts after 2 hours, `scheduler.py` will split the task into two seamless `ScheduleBlock` instances rather than relying on the AI to understand the split.
- **Unified Exam Context Pipeline:** Integrating the initial PDF parsing (`syllabus_parser.py`) cleanly with the database, so `routes.py` manages the state, and `exam_brain.py` just pulls the sanitized parameters.

## Claude's Discretion (Guidance for Research/Planning)
- Refactoring the `_build_calendar_prompt` to maximize pedagogical reasoning while enforcing the lean JSON schema.
- The mathematical logic required in `scheduler.py` to handle task-splitting across fixed break boundaries smoothly.

## Deferred Ideas
- **Predictive Task Durations:** Having the system learn and suggest how long a task actually takes based on user completion history, replacing the AI's initial estimate over time.
