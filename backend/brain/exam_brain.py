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

    async def analyze_all_exams(self) -> dict:
        exam_contexts = []
        for exam in self.exams:
            # Check for pre-parsed context in the DB
            parsed = exam.get("parsed_context")
            if parsed:
                try:
                    context_data = json.loads(parsed) if isinstance(parsed, str) else parsed
                except:
                    context_data = None
            else:
                context_data = None

            exam_contexts.append({
                "exam_id": exam["id"],
                "name": exam["name"],
                "subject": exam["subject"],
                "exam_date": exam["exam_date"],
                "special_needs": exam.get("special_needs", ""),
                "parsed_context": context_data,
            })

        if self.client:
            try:
                return self._analyze_with_ai(exam_contexts)
            except Exception as e:
                print(f"AI strategy generation failed: {e}")
                return {"tasks": [], "prompt": "", "raw_response": str(e)}
        else:
            return {"tasks": [], "prompt": "No AI client available", "raw_response": ""}

    def _analyze_with_ai(self, exam_contexts: list[dict]) -> dict:
        valid_exam_ids = {ec["exam_id"] for ec in exam_contexts}
        prompt = self._build_strategy_prompt(exam_contexts)
        message = self.client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=4000,
            messages=[{"role": "user", "content": prompt}],
        )
        raw_response = message.content[0].text.strip()
        response_text = raw_response
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
                    exam_id = list(valid_exam_ids)[0]
                else:
                    continue
            validated.append({
                "exam_id": exam_id,
                "title": task["title"],
                "sort_order": task.get("sort_order", 0),
                "estimated_hours": max(0.5, min(6.0, float(task.get("estimated_hours", 2.0)))),
                "priority": max(1, min(10, int(task.get("priority", 5)))),
            })
        return {
            "tasks": validated,
            "prompt": prompt,
            "raw_response": raw_response
        }

    def _build_strategy_prompt(self, exam_contexts: list[dict]) -> str:
        exam_sections = []
        for ec in exam_contexts:
            context_str = "No specific syllabus data provided."
            if ec["parsed_context"]:
                context_str = json.dumps(ec["parsed_context"], indent=2)
            
            section = f"""
### Exam: {ec['name']}
- Subject: {ec['subject']}
- Exam ID: {ec['exam_id']}
- Context/Topics:
{context_str}
---"""
            exam_sections.append(section)

        exams_text = "\n".join(exam_sections)
        return f"""You are a Strategic Study Architect. Your task is to decompose university exams into a prioritized queue of study tasks.

STUDENT EXAMS:
{exams_text}

OUTPUT RULES (STRICT):
1. NO DATES: Do NOT assign tasks to specific days or dates.
2. PRIORITY QUEUE: Assign each task a "priority" (1-10, where 10 is highest/urgent) and a "sort_order".
3. GRANULARITY: Each task should be 1.5 to 3.0 hours. Break large topics into specific sub-tasks.
4. ZERO-DATA POLICY: If no syllabus context is provided for an exam, use the subject name to generate a standard high-performance study sequence (e.g., "Review fundamental concepts of [Subject]", "Solve practice exams for [Subject]").
5. ACTIONABLE TITLES: Use specific verbs (e.g., "Solve...", "Summarize...", "Simulate...").
6. LANGUAGE: Match the language of the exam name.

RETURN ONLY A JSON ARRAY OF OBJECTS:
[
  {{
    "exam_id": <int>,
    "title": "String (Hebrew/English)",
    "estimated_hours": <float>,
    "sort_order": <int>,
    "priority": <int>
  }}
]

No text before or after the JSON."""

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
