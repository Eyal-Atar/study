---
created: 2026-03-01T12:49:16.418Z
title: Redesign schedule confirmation as two-step wizard
area: ui
files:
  - frontend/js/
---

## Problem

The current schedule confirmation screen has major UX issues:

1. **Cognitive overload** — Single long-scroll page with all info (gaps, topic map, 69 tasks) crammed together
2. **Mixed context** — Tasks from different courses (e.g. Intro to CS, Calculus) appear in the same stream, making navigation difficult
3. **Text overload** — AI explanations shown in full by default, consuming excessive screen space
4. **Unnecessary metrics** — Showing "69 tasks" stresses users instead of letting the algorithm handle scheduling

## Solution

Replace with a **two-step In/Out wizard**:

### Step 1: Topic Triage
- Clean list of topics and gaps the system identified
- Everything marked "in" by default — user removes only what they fully master
- Toggle/remove button per topic
- "Continue to tasks" CTA

### Step 2: Task Selection (filtered by Step 1)
- **Course tabs** at top (e.g. "Intro to CS" | "Calculus") — show one course at a time
- Swipe-to-delete or X button for quick removal (no checkboxes — everything approved by default)
- "Approve & Generate Schedule" CTA

### UX Guidelines
- **Progressive disclosure**: Hide AI explanations behind accordion/info icon
- **Hide metrics**: Remove task counts and time estimates from UI (keep in backend for scheduling)
- **Stepper bar**: Show progress indicator (1. Choose Topics → 2. Filter Tasks)
- **State management**: Store only rejected IDs; filter original list on submit; send only approved items to backend
- Minimalist, calm design — guide user step by step
