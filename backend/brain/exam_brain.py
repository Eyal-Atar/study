"""ExamBrain — AI core that builds day-by-day study calendars."""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
import anthropic
import fitz  # PyMuPDF

EXCLUSIVE_ZONE_DAYS = 4


def extract_text_from_pdf(file_path: str, max_pages: int = 10) -> str:
    try:
        doc = fitz.open(file_path)
        text = ""
        for i, page in enumerate(doc):
            if i >= max_pages:
                break
            text += page.get_text() + "\n"
        doc.close()
        return text.strip()
    except Exception:
        return ""


class ExamBrain:
    def __init__(self, user: dict, exams: list[dict]):
        self.user = user
        self.exams = exams
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        self.client = anthropic.Anthropic(api_key=api_key) if api_key else None

    async def analyze_all_exams(self) -> list[dict]:
        exam_contexts = []
        for exam in self.exams:
            file_texts = []
            for f in exam.get("files", []):
                if f["file_path"].lower().endswith(".pdf"):
                    text = extract_text_from_pdf(f["file_path"])
                    if text:
                        file_texts.append({
                            "filename": f["filename"],
                            "type": f["file_type"],
                            "content": text[:5000],
                        })
            exam_contexts.append({
                "exam_id": exam["id"],
                "name": exam["name"],
                "subject": exam["subject"],
                "exam_date": exam["exam_date"],
                "special_needs": exam.get("special_needs", ""),
                "files": file_texts,
            })

        if self.client:
            try:
                return self._analyze_with_ai(exam_contexts)
            except Exception as e:
                print(f"AI analysis failed: {e}, falling back to basic calendar")
                return self._generate_basic_calendar(exam_contexts)
        else:
            return self._generate_basic_calendar(exam_contexts)

    def _analyze_with_ai(self, exam_contexts: list[dict]) -> list[dict]:
        valid_exam_ids = {ec["exam_id"] for ec in exam_contexts}
        prompt = self._build_calendar_prompt(exam_contexts)
        message = self.client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=8000,
            messages=[{"role": "user", "content": prompt}],
        )
        response_text = message.content[0].text.strip()
        if response_text.startswith("```"):
            response_text = response_text.split("\n", 1)[1]
            response_text = response_text.rsplit("```", 1)[0]

        tasks = json.loads(response_text)
        validated = []
        for task in tasks:
            if not task.get("title"):
                continue
            exam_id = task.get("exam_id")
            if exam_id not in valid_exam_ids:
                if len(valid_exam_ids) == 1:
                    exam_id = next(iter(valid_exam_ids))
                else:
                    continue
            validated.append({
                "exam_id": exam_id,
                "title": task["title"],
                "topic": task.get("topic"),
                "subject": task.get("subject"),
                "day_date": task.get("day_date"),
                "sort_order": task.get("sort_order", 0),
                "deadline": task.get("day_date"),
                "estimated_hours": max(0.0, min(8.0, float(task.get("estimated_hours", 2.0)))),
                "difficulty": max(0, min(5, int(task.get("difficulty", 3)))),
            })
        return validated

    def _build_calendar_prompt(self, exam_contexts: list[dict]) -> str:
        today = datetime.now().strftime("%Y-%m-%d")
        today_weekday = datetime.now().strftime("%A")

        exam_sections = []
        for ec in exam_contexts:
            days_until = (datetime.fromisoformat(ec["exam_date"]) - datetime.now()).days
            section = f"""
### Exam: {ec['name']}
- Subject: {ec['subject']}
- Exam ID: {ec['exam_id']}
- Date: {ec['exam_date']} ({days_until} days from now)
- Special needs: {ec.get('special_needs') or 'None'}
"""
            for f in ec["files"]:
                section += f"\n#### File: {f['filename']} (type: {f['type']})\n{f['content']}\n---"
            exam_sections.append(section)

        exams_text = "\n".join(exam_sections)
        return f"""You are an expert private tutor creating a logical, high-performance study calendar for university exams.

Today: {today} ({today_weekday})

Student's exams:
{exams_text}

Study preferences: available {self.user.get('wake_up_time', '08:00')} to {self.user.get('sleep_time', '23:00')}, ~{self.user.get('session_minutes', 50)} min sessions, max ~{self.user.get('neto_study_hours', 6)} hours/day.

CREATE A DAY-BY-DAY STUDY CALENDAR from today until the last exam.

RULES:
1. SINGLE FOCUS RULE: Each day MUST focus on ONE exam only. Do not mix exams unless a deadline is less than 48 hours away.
2. SIMULATION-FIRST TEMPLATE: For intense study days (especially the last 5 days before an exam), use this exact chronological structure:
   A. Peak Focus (Morning): Full Exam Simulation (Real conditions).
   B. Deep Review (תחקיר): Systematic analysis of simulation mistakes.
   C. Targeted Fixes: Specific practice on weak subtopics identified in the review.
3. GRANULARITY & DENSITY: DO NOT create single large tasks (e.g., "Study for 6 hours"). 
   Instead, break every topic into multiple smaller, actionable tasks (1.0 to 2.5 hours each). 
   Each day should have 3-6 distinct tasks to fill the student's available study time (~6 hours).
4. SPECIFICITY: Activities MUST be ACTIONABLE — NOT "Study Algebra" but "Solve eigenvalue problems from 2023 Final Exam" or "Trace memory leaks in C pointers worksheet".
5. PROGRESSION: Initial days: Mapping material & fundamental practice. Final days: 100% simulations and review.
6. EXAM DAY: Mark as "EXAM DAY: <exam_name>" with difficulty=0, estimated_hours=0.
7. LANGUAGE: Match the language of the exam name. If exam name is in Hebrew, write activities in Hebrew. If in English, write in English.

Return ONLY valid JSON — an array of objects:
[
  {{
    "day_date": "2026-02-05",
    "exam_id": <exam_id>,
    "title": "Full Simulation: 2024 Semester A Final",
    "topic": "Exam Simulation",
    "subject": "Calculus 1",
    "sort_order": 1,
    "difficulty": 5,
    "estimated_hours": 3.0
  }}
]

No explanation, no markdown. Just the JSON array."""

    def _generate_basic_calendar(self, exam_contexts: list[dict]) -> list[dict]:
        """Generate a day-by-day calendar from exam dates (no AI needed)."""
        tasks = []
        now = datetime.now()
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)

        sorted_exams = sorted(exam_contexts, key=lambda ec: ec["exam_date"])
        exam_date_map = {}
        for ec in sorted_exams:
            try:
                exam_date_map[ec["exam_id"]] = datetime.fromisoformat(ec["exam_date"])
            except (ValueError, TypeError):
                continue

        if not exam_date_map:
            return []

        last_exam = max(exam_date_map.values())
        total_days = max(1, (last_exam.date() - today.date()).days + 1)

        for day_offset in range(min(total_days, 60)):
            day = today + timedelta(days=day_offset)
            day_str = day.strftime("%Y-%m-%d")

            active = [
                (eid, edate) for eid, edate in exam_date_map.items()
                if edate.date() >= day.date()
            ]
            if not active:
                continue

            active.sort(key=lambda x: x[1])
            focus_eid, focus_date = active[0]
            focus_ec = next(ec for ec in sorted_exams if ec["exam_id"] == focus_eid)
            days_until = (focus_date.date() - day.date()).days
            subj = focus_ec["subject"]

            if days_until == 0:
                tasks.append({
                    "exam_id": focus_eid, "day_date": day_str, "deadline": day_str,
                    "title": f"EXAM DAY: {focus_ec['name']}",
                    "topic": None, "subject": subj,
                    "sort_order": 1, "estimated_hours": 0, "difficulty": 0,
                })
            elif days_until == 1:
                tasks.extend([
                    {"exam_id": focus_eid, "day_date": day_str, "deadline": day_str,
                     "title": f"{subj}: Warmup & Summary Review",
                     "topic": "Pre-exam warmup", "subject": subj,
                     "sort_order": 1, "estimated_hours": 1.5, "difficulty": 2},
                ])
            elif days_until <= 5:
                # Simulation First Template
                tasks.extend([
                    {"exam_id": focus_eid, "day_date": day_str, "deadline": day_str,
                     "title": f"{subj}: Full-Length Exam Simulation",
                     "topic": "Simulation", "subject": subj,
                     "sort_order": 1, "estimated_hours": 3.0, "difficulty": 5},
                    {"exam_id": focus_eid, "day_date": day_str, "deadline": day_str,
                     "title": f"{subj}: Simulation Review & Deep Analysis (תחקיר)",
                     "topic": "Review", "subject": subj,
                     "sort_order": 2, "estimated_hours": 1.5, "difficulty": 4},
                    {"exam_id": focus_eid, "day_date": day_str, "deadline": day_str,
                     "title": f"{subj}: Targeted Weakness Practice",
                     "topic": "Practice", "subject": subj,
                     "sort_order": 3, "estimated_hours": 1.5, "difficulty": 4},
                ])
            else:
                tasks.extend([
                    {"exam_id": focus_eid, "day_date": day_str, "deadline": day_str,
                     "title": f"{subj}: Core Material Study",
                     "topic": "New material", "subject": subj,
                     "sort_order": 1, "estimated_hours": 3.0, "difficulty": 3},
                    {"exam_id": focus_eid, "day_date": day_str, "deadline": day_str,
                     "title": f"{subj}: Practice Exercises",
                     "topic": "Practice", "subject": subj,
                     "sort_order": 2, "estimated_hours": 2.0, "difficulty": 3},
                ])

        return tasks
