# Phase 20: LLM Optimization & Evaluation Dashboard - Context Phase Boundary

## Overview
Establishing an isolated testing environment to evaluate and migrate from the current model to a faster, more cost-effective LLM. This phase focuses on side-by-side visual comparison, testing the two-step agent chain (Strategist -> Scheduler), and enabling a zero-friction model swap in production without altering the core backend logic.

## Implementation Decisions

### Isolated Evaluation Environment (Streamlit)
- **Separate Dashboard:** Built using Streamlit, running as an independent process entirely decoupled from the main FastAPI server and React frontend.
- **Side-by-Side UI:** Visual interface comparing the original model's output with the alternative model's output in two columns for immediate inspection.
- **Two-Step Chain Simulation:** The dashboard will independently test the "Strategist" (planning) and the "Scheduler" (JSON generation) to isolate points of failure between the agents.

### Routing & Zero-Friction Integration
- **Unified Interface:** Utilizing the `litellm` library in both the evaluation dashboard and the main backend to standardize API calls across different providers.
- **Environment-Driven Swap:** Model replacement in production will be executed solely by updating the `LLM_MODEL` key in the `.env` file, requiring zero logic changes in the code.
- **Fallback Mechanism:** Implementing an automatic, silent fallback route to the original, more capable model if the cheaper model times out or returns malformed data.

### Evaluation Methodology
- **LLM-as-a-Judge:** Using a powerful model to analyze the cheaper model's mistakes and automatically generate compensating System Prompts to close the quality gap.
- **Strict Determinism:** Enforcing `temperature=0` across all tests to ensure predictable, mathematical, and logical scheduling without creative hallucinations.
- **JSON Enforcement:** Utilizing strict JSON mode (`response_format`) to prevent cheaper models from adding conversational filler that breaks the UI rendering.

## Specific Ideas
- **Golden Dataset:** Compiling 5-10 real-world edge cases (e.g., tight windows between lectures, conflicting work/workout constraints, heavy exam study days) to serve as the ultimate benchmark.
- **Handoff Monitoring:** Paying special attention to the intermediate data passed from the Strategist to the Scheduler, as smaller models often lose context during this transition.
- **Objective Metrics:** Evaluating success strictly based on latency reduction, JSON structural integrity, and adherence to logical constraints.

## Claude's Discretion (Guidance for Research/Planning)
- Exact layout, interactive elements, and visual components of the Streamlit comparison dashboard.
- The precise phrasing of the "LLM-as-a-Judge" prompt to extract the most effective compensating instructions.
- Selection of the initial alternative models to test in the arena.

## Deferred Ideas
- **Native Mobile Application:** Wrapping the React PWA into a native mobile app using Capacitor (or transitioning to React Native/Expo) is strictly postponed until after Phase 20 to maintain focus on Web-First stability.
