# Phase 20: LLM Optimization & Evaluation Dashboard - Context

## Visual Comparison & Metrics
- **Hierarchy-First View:** The dashboard will feature a visual JSON Tree View to easily inspect task structures and timing, alongside a "Raw Text" tab to monitor for unwanted model conversational filler (chatter).
- **Critical KPIs:** Every model output (Current vs. Challenger) will prominently display:
    - **Latency:** Real-time response time in seconds.
    - **Cost:** Estimated cost per 1,000 tokens based on model pricing.
- **Diff Highlighting:** Visual emphasis on critical deviations, such as JSON schema mismatches or significant shifts in task start/end times.
- **Scoring System:** A dual-layer validation approach:
    - **Structural (Pass/Fail):** Hard validation of JSON schema and parsing.
    - **Logical (1-10):** A quality score assigned by the "Judge" model based on scheduling constraints.

## Interactive Playground & Iteration
- **Live Prompt Engineering:** A dedicated System Prompt editor for the Challenger model. Developers can modify instructions and trigger an immediate "Re-run" for rapid feedback loops.
- **Regression Guard (Batch Testing):** A "Run All" feature to execute the current prompt against the entire Golden Dataset, ensuring new prompt fixes don't break existing successful scenarios.
- **Dynamic Model Arena:** A dropdown menu utilizing `litellm` to hot-swap challenger models (e.g., Gemini 1.5 Flash, Llama 3) for side-by-side benchmarking.
- **Safe Export:** To prevent accidental overrides, the dashboard will not modify `.env` or production code directly. Instead, a "Copy System Prompt" button will be provided to move successful instructions into the codebase manually.

## Golden Dataset & Automated Judging
- **Flat File Management:** Test cases will be stored in a simple, manually-edited `golden_cases.json` within the testing directory.
- **Test Case Schema:** Each scenario must include:
    - Reference current time.
    - List of academic tasks (e.g., coding, math).
    - Hard windows (Lectures, Gym/Running).
    - Sleep constraints.
- **Judge Responsibilities:** The "Judge" model focuses strictly on hard logic and mathematical errors:
    - Overlapping tasks.
    - Time-frame violations.
    - Ignored mandatory lectures.
- **Judge Output:** For every failure, the judge provides a concise critique and a **Compensating Prompt**—a specific instruction snippet designed to be added to the Challenger's System Prompt to rectify the detected logic failure.
