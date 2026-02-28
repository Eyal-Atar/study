"""ExamBrain — AI core that builds day-by-day study calendars."""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
import anthropic
import fitz  # PyMuPDF

EXCLUSIVE_ZONE_DAYS = 4


def extract_text_from_pdf(file_path: str, max_pages: int = None) -> str:
    try:
        doc = fitz.open(file_path)
        text = ""
        for i, page in enumerate(doc):
            if max_pages is not None and i >= max_pages:
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
        all_tasks = []
        all_prompts = []
        all_raw_responses = []
        
        now = datetime.now()
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        neto_h = float(self.user.get("neto_study_hours", 4.0))

        for exam in self.exams:
            # Calculate target hours for THIS exam
            try:
                # Handle potential 'Z' or offset in ISO format
                ed_str = exam["exam_date"].replace('Z', '+00:00')
                exam_date = datetime.fromisoformat(ed_str).replace(tzinfo=None)
                days_until = max(1, (exam_date - today).days)
                target_hours = float(days_until * neto_h)
            except Exception as e:
                print(f"Error calculating target hours for {exam.get('name')}: {e}")
                target_hours = 10.0

            # Check for pre-parsed context
            parsed = exam.get("parsed_context")
            if parsed:
                try:
                    context_data = json.loads(parsed) if isinstance(parsed, str) else parsed
                except:
                    context_data = None
            else:
                context_data = None

            ec = {
                "exam_id": exam["id"],
                "name": exam["name"],
                "subject": exam["subject"],
                "exam_date": exam["exam_date"],
                "special_needs": exam.get("special_needs", ""),
                "parsed_context": context_data,
            }

            if self.client:
                try:
                    res = self._analyze_single_exam_with_ai(ec, target_hours)
                    all_tasks.extend(res["tasks"])
                    all_prompts.append(res["prompt"])
                    all_raw_responses.append(res["raw_response"])
                except Exception as e:
                    print(f"AI generation failed for exam {exam['id']}: {e}")
            
        return {
            "tasks": all_tasks,
            "prompt": "\n---\n".join(all_prompts),
            "raw_response": "\n---\n".join(all_raw_responses)
        }

    def _analyze_single_exam_with_ai(self, ec: dict, target_hours: float) -> dict:
        prompt = self._build_strategy_prompt(ec, target_hours)
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

        try:
            tasks = json.loads(response_text)
        except json.JSONDecodeError:
            print(f"Failed to parse AI response: {response_text}")
            tasks = []

        validated = []
        for task in tasks:
            if not task.get("title"):
                continue
            validated.append({
                "exam_id": ec["exam_id"],
                "title": task["title"],
                "subject": ec["subject"],
                "topic": task.get("topic"),
                "sort_order": task.get("sort_order", 0),
                "estimated_hours": max(0.5, min(6.0, float(task.get("estimated_hours", 2.0)))),
                "priority": max(1, min(10, int(task.get("priority", 5)))),
            })
        return {
            "tasks": validated,
            "prompt": prompt,
            "raw_response": raw_response
        }

    def _build_strategy_prompt(self, ec: dict, target_hours: float) -> str:
        context_str = "No specific syllabus data provided."
        if ec["parsed_context"]:
            context_str = json.dumps(ec["parsed_context"], indent=2)
        
        exam_text = f"""
### Exam: {ec['name']}
- Subject: {ec['subject']}
- Exam ID: {ec['exam_id']}
- Target Total Study Hours: {target_hours}
- Context/Topics:
{context_str}
"""

        return f"""You are a Strategic Study Architect. Your task is to decompose a university exam into a prioritized queue of study tasks.

STUDENT EXAM:
{exam_text}

OUTPUT RULES (STRICT):
1. TARGET HOURS: You MUST generate enough specific sub-tasks so that the sum of their "estimated_hours" equals exactly {target_hours} hours. This is critical to ensure the student has a full schedule until the exam.
2. MANDATORY TEMPLATE: You MUST include at least one task named 'Full-Length Exam Simulation' (estimated_hours: 3.0) and at least one task named 'Simulation Review & Deep Analysis / תחקיר' (estimated_hours: 1.5) for the final stages of study for this exam. These must have the highest "sort_order" so they are scheduled last.
3. NO DATES: Do NOT assign tasks to specific days or dates.
4. PRIORITY QUEUE: Assign each task a "priority" (1-10, where 10 is highest/urgent) and a "sort_order".
5. GRANULARITY: Each task should be 1.5 to 3.0 hours. Break large topics into many specific sub-tasks to reach the target hours.
6. ZERO-DATA POLICY: If no syllabus context is provided, use the subject name to generate a standard high-performance study sequence totaling {target_hours} hours.
7. ACTIONABLE TITLES: Use specific verbs (e.g., "Solve...", "Summarize...", "Simulate...").
8. LANGUAGE: Match the language of the exam name.

RETURN ONLY A JSON ARRAY OF OBJECTS:
[
  {{
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
