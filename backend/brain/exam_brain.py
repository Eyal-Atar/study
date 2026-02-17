"""ExamBrain — AI core that analyzes exams and builds study roadmaps."""
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

        has_files = any(len(ec["files"]) > 0 for ec in exam_contexts)
        if has_files and self.client:
            try:
                return self._analyze_with_ai(exam_contexts)
            except Exception as e:
                print(f"AI analysis failed: {e}, falling back to basic tasks")
                return self._generate_basic_tasks(exam_contexts)
        else:
            return self._generate_basic_tasks(exam_contexts)

    def _analyze_with_ai(self, exam_contexts: list[dict]) -> list[dict]:
        valid_exam_ids = {ec["exam_id"] for ec in exam_contexts}
        prompt = self._build_mega_prompt(exam_contexts)
        message = self.client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=4000,
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
            # Fix invalid exam_ids from AI
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
                "deadline": task.get("deadline"),
                "estimated_hours": max(0.5, min(8.0, float(task.get("estimated_hours", 2.0)))),
                "difficulty": max(1, min(5, int(task.get("difficulty", 3)))),
            })
        return validated

    def _build_mega_prompt(self, exam_contexts: list[dict]) -> str:
        today = datetime.now().strftime("%Y-%m-%d")
        exam_sections = []
        for ec in exam_contexts:
            days_until = (datetime.fromisoformat(ec["exam_date"]) - datetime.now()).days
            section = f"""
### Exam: {ec['name']}
- Subject: {ec['subject']}
- Date: {ec['exam_date']} ({days_until} days from now)
- Special needs: {ec.get('special_needs') or 'None'}
"""
            for f in ec["files"]:
                section += f"\n#### File: {f['filename']} (type: {f['type']})\n{f['content']}\n---"
            exam_sections.append(section)

        exams_text = "\n".join(exam_sections)
        return f"""You are an expert study planner for university students.

Today's date: {today}

The student has these upcoming exams:
{exams_text}

Student's study preferences:
- Studies from {self.user.get('wake_up_time', '08:00')} to {self.user.get('sleep_time', '23:00')}
- Method: {self.user.get('study_method', 'pomodoro')} ({self.user.get('session_minutes', 50)} min sessions)

IMPORTANT SCHEDULING RULES:
- The last 4 days before each exam should be dedicated EXCLUSIVELY to that exam
- The last 1-2 days should be review/practice only
- Tasks should cover from today until the exam date
- Set deadlines that ensure all material is covered before the 4-day exclusive zone

TASK: Break down each exam into specific study tasks/topics. For each task:
1. Create focused, actionable study tasks
2. Estimate realistic hours needed
3. Rate difficulty 1-5
4. Set deadlines that spread evenly, finishing new material 4 days before exam
5. Add review/practice tasks for the last 4 days
6. Consider special needs and weak areas

Create 4-10 tasks per exam depending on complexity and time available.

Return ONLY valid JSON — an array of objects:
[
  {{
    "exam_id": <exam_id>,
    "title": "Study Chapter 3: Vector Spaces",
    "topic": "Vector Spaces - basis, dimension",
    "subject": "Linear Algebra",
    "deadline": "2026-03-13",
    "estimated_hours": 4.0,
    "difficulty": 4
  }}
]

No explanation, no markdown wrapping. Just the JSON array."""

    def _generate_basic_tasks(self, exam_contexts: list[dict]) -> list[dict]:
        tasks = []
        for ec in exam_contexts:
            exam_date = datetime.fromisoformat(ec["exam_date"])
            days_until = (exam_date - datetime.now()).days

            if days_until <= 3:
                task_templates = [
                    ("Intensive review", 3.0, 4),
                    ("Practice problems", 2.0, 3),
                ]
            elif days_until <= 7:
                task_templates = [
                    ("Review core concepts", 3.0, 3),
                    ("Practice problems", 2.5, 3),
                    ("Study weak areas", 3.0, 4),
                    ("Final review & summary", 2.0, 2),
                ]
            else:
                task_templates = [
                    ("Learn new material (Part 1)", 3.5, 4),
                    ("Learn new material (Part 2)", 3.5, 4),
                    ("Practice problems set 1", 2.5, 3),
                    ("Study weak areas", 3.0, 4),
                    ("Practice problems set 2", 2.5, 3),
                    ("Review past exams", 2.0, 2),
                    ("Comprehensive review", 3.0, 3),
                    ("Final review & summary", 2.0, 2),
                ]

            for i, (title, hours, diff) in enumerate(task_templates):
                if "review" in title.lower() or "summary" in title.lower():
                    days_before = max(0, min(3, len(task_templates) - 1 - i))
                else:
                    study_window = max(1, days_until - EXCLUSIVE_ZONE_DAYS)
                    days_before = EXCLUSIVE_ZONE_DAYS + max(1, int((len(task_templates) - i) * study_window / len(task_templates)))

                deadline = (exam_date - timedelta(days=days_before)).strftime("%Y-%m-%d")

                tasks.append({
                    "exam_id": ec["exam_id"],
                    "title": f"{ec['subject']}: {title}",
                    "topic": title,
                    "subject": ec["subject"],
                    "deadline": deadline,
                    "estimated_hours": hours,
                    "difficulty": diff,
                })
        return tasks
