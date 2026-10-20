
---
phase: 8
title: Hourly Time Slot Scheduling
status: discussed
---

# Phase Context: 08-Hourly Scheduling

## Overview
Transform the roadmap from vague daily lists into a precise, hourly schedule. This phase establishes the data structures for hourly blocks and the UI foundation for drag-and-drop management.

## Visual & Interaction Decisions
- **Draggability:** The hourly grid must support dragging tasks to change their time slots (UI foundation for Phase 9).
- **Task Metadata:** Each hourly block in the calendar must display:




    - Related Exam Name.
    - Specific File Name (if a PDF was uploaded for that exam).
    - Precise Time Window (e.g., 10:00 - 13:00).
- **Real Exam Simulations:** Special visual treatment for "Exam Simulation" tasks or "Submission" events.
- **Hobby/Break Slot:**
    - Must have a unique color to distinguish it from study tasks.
    - Default duration: 2 hours (user-customizable).

## AI & Algorithm Decisions
- **Overflow Strategy:** In cases of overload (more study hours required than available Neto hours), prioritize tasks by the nearest exam deadline.
- **Rollover Logic:** Uncompleted tasks from previous days must automatically roll over into today's hourly slots.
- **Buffers:** No automatic buffers between tasks; schedule blocks strictly back-to-back.
- **Delay Visibility:** Tasks that have been pushed to a subsequent day due to overflow must be visually highlighted as "Delayed."

## Localization & Timezone
- **Display Timezone:** Always use the machine's local timezone for the UI view.
- **Storage:** All hourly blocks must be stored in UTC ISO 8601 format.

## Deferred / Out of Scope
- Full drag-to-resize logic (Phase 9).
- Manual task creation via clicking empty slots (Phase 9).
