"""ExamBrain — AI core that builds day-by-day study calendars."""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
import anthropic
import fitz  # PyMuPDF

EXCLUSIVE_ZONE_DAYS = 4
CHAR_LIMIT = 700_000  # ~175K tokens, safe margin under Haiku's 200K token context


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

    # ------------------------------------------------------------------
    # Auditor helpers (Plan 02)
    # ------------------------------------------------------------------

    def _build_all_exam_context(self) -> str:
        """Concatenate all exams + all their extracted_text into a single string.

        Iterates through self.exams, fetches associated exam_files from the DB,
        and concatenates their extracted_text with clear headers.
        Falls back to parsed_context for legacy exams with no uploaded files.
        Enforces a hard CHAR_LIMIT with truncation.
        """
        from server.database import get_db

        db = get_db()
        parts = []
        total_chars = 0

        try:
            for exam in self.exams:
                exam_header = (
                    f"\n### EXAM: {exam['name']} ({exam['subject']}) "
                    f"— Date: {exam['exam_date']} — Exam ID: {exam['id']}\n"
                )

                files = db.execute(
                    "SELECT file_type, filename, extracted_text FROM exam_files WHERE exam_id = ?",
                    (exam["id"],),
                ).fetchall()

                file_texts = []
                for f in files:
                    if f["extracted_text"]:
                        file_texts.append(
                            f"[{f['file_type'].upper()}: {f['filename']}]\n{f['extracted_text']}"
                        )

                # Fallback: use old parsed_context (topics/intensity/objectives)
                if not file_texts and exam.get("parsed_context"):
                    file_texts.append(
                        f"[LEGACY CONTEXT]\n{exam['parsed_context']}"
                    )

                exam_block = exam_header + "\n\n".join(file_texts)

                # Truncate if adding this exam would exceed the character limit
                if total_chars + len(exam_block) > CHAR_LIMIT:
                    remaining = CHAR_LIMIT - total_chars
                    if remaining <= 0:
                        break
                    exam_block = exam_block[:remaining] + "\n[TRUNCATED — file too large]"

                parts.append(exam_block)
                total_chars += len(exam_block)

                if total_chars >= CHAR_LIMIT:
                    break
        finally:
            db.close()

        print(f"DEBUG ExamBrain: assembled context — {total_chars} chars across {len(parts)} exam(s)")
        return "\n\n".join(parts)

    def _calculate_total_hours(self) -> float:
        """Sum up days_until * neto_study_hours for all exams to get global budget."""
        now = datetime.now()
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        neto_h = float(self.user.get("neto_study_hours", 4.0))
        total = 0.0

        for exam in self.exams:
            try:
                ed_str = exam["exam_date"].replace("Z", "+00:00")
                exam_date = datetime.fromisoformat(ed_str).replace(tzinfo=None)
                days_until = max(1, (exam_date - today).days)
                total += days_until * neto_h
            except Exception as e:
                print(f"ExamBrain._calculate_total_hours: skipping exam {exam.get('id')}: {e}")
                total += 10.0  # safe fallback

        return round(total, 2)

    def _build_auditor_prompt(self, all_exam_context: str, total_hours: float) -> str:
        """Build the system prompt for the Auditor (API Call 1).

        The Auditor identifies syllabus topics, detects gaps, decomposes tasks,
        assigns focus_score (1-10), reasoning, and dependency_id.
        Output: JSON with tasks, gaps, and topic_map keys.
        """
        exam_ids_str = ", ".join(str(e["id"]) for e in self.exams)
        peak = self.user.get("peak_productivity", "Morning")

        return f"""RETURN ONLY VALID JSON — NO TEXT BEFORE OR AFTER.

You are a Zero-Loss Knowledge Auditor for a university student.

STUDENT PROFILE:
- Total available study hours across all exams: {total_hours}
- Peak productivity window: {peak}
- Valid exam_ids: [{exam_ids_str}]

ALL EXAM MATERIALS:
{all_exam_context}

TASK:
1. For each exam, map all syllabus topics.
2. Identify which topics have matching summary/notes content and which are GAPS (topic appears in syllabus but no study material found in summaries/notes).
3. Decompose ALL topics into specific, actionable pedagogical tasks with:
   - focus_score (1-10): concentration level required (1=easy/repetitive, 10=extreme cognitive load)
   - reasoning: 1-sentence explanation of the focus_score (e.g. "Requires memorisation of formulas — low cognitive load" or "Abstract proofs require deep focus")
   - dependency_id: null OR the index of a prerequisite task in this same output list (0-based)
   - estimated_hours per task (0.5 to 3.0 hours)
4. Assign each task to the correct exam_id.
5. Use specific action verbs in titles (Solve, Summarize, Simulate, Review, Practice).
6. Match the language of the exam name (Hebrew exams → Hebrew task titles).

RETURN ONLY VALID JSON — NO TEXT BEFORE OR AFTER:
{{
  "tasks": [
    {{
      "exam_id": <int — must be one of [{exam_ids_str}]>,
      "title": "<string>",
      "topic": "<string>",
      "estimated_hours": <float 0.5-3.0>,
      "focus_score": <int 1-10>,
      "reasoning": "<string — 1 sentence explaining the focus_score>",
      "dependency_id": <null or 0-based index into this tasks array>,
      "sort_order": <int>
    }}
  ],
  "gaps": [
    {{
      "exam_id": <int>,
      "topic": "<string>",
      "description": "<string — why this is a gap>"
    }}
  ],
  "topic_map": {{
    "<exam_id as string>": ["topic1", "topic2"]
  }}
}}"""

    async def call_split_brain(self) -> dict:
        """Auditor-only execution: API Call 1 of the Split-Brain architecture.

        Assembles context for all exams, builds the Auditor prompt, calls
        Claude Haiku once, parses the JSON response, and returns the structured
        Auditor output containing tasks, gaps, and topic_map.

        Does NOT run the Strategist or the Scheduler — the caller persists this
        output to auditor_draft and returns it to the frontend for review.
        """
        if not self.client:
            raise RuntimeError("ANTHROPIC_API_KEY is not set — cannot run Auditor")

        all_exam_context = self._build_all_exam_context()
        total_hours = self._calculate_total_hours()
        prompt = self._build_auditor_prompt(all_exam_context, total_hours)

        print(f"DEBUG ExamBrain.call_split_brain: calling Claude Haiku — prompt length {len(prompt)} chars")

        message = self.client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=8000,
            messages=[{"role": "user", "content": prompt}],
        )
        raw_response = message.content[0].text.strip()
        print(f"DEBUG ExamBrain.call_split_brain: raw response length {len(raw_response)} chars")

        # Robust JSON parsing: strip markdown fences, find first { and last }
        response_text = raw_response
        if response_text.startswith("```"):
            # Strip opening fence (e.g. ```json\n or ```\n)
            response_text = response_text.split("\n", 1)[1] if "\n" in response_text else response_text[3:]
            # Strip closing fence
            response_text = response_text.rsplit("```", 1)[0]

        # Find JSON object boundaries in case there is preamble text
        first_brace = response_text.find("{")
        last_brace = response_text.rfind("}")
        if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
            response_text = response_text[first_brace: last_brace + 1]

        try:
            auditor_result = json.loads(response_text)
        except json.JSONDecodeError as exc:
            print(f"ExamBrain.call_split_brain: JSON parse failed — {exc}\nRaw: {raw_response[:500]}")
            auditor_result = {"tasks": [], "gaps": [], "topic_map": {}}

        tasks = auditor_result.get("tasks", [])
        gaps = auditor_result.get("gaps", [])
        topic_map = auditor_result.get("topic_map", {})

        # Validate and normalise tasks
        valid_exam_ids = {e["id"] for e in self.exams}
        validated_tasks = []
        for idx, task in enumerate(tasks):
            if not task.get("title"):
                continue

            # Clamp focus_score to [1, 10]
            fs = task.get("focus_score", 5)
            try:
                fs = max(1, min(10, int(fs)))
            except (ValueError, TypeError):
                fs = 5

            # Ensure reasoning is present
            reasoning = task.get("reasoning") or "No reasoning provided."

            # Normalise dependency_id: must be null or a valid 0-based integer
            dep_id = task.get("dependency_id")
            if dep_id is not None:
                try:
                    dep_id = int(dep_id)
                    if dep_id < 0 or dep_id >= len(tasks):
                        dep_id = None
                except (ValueError, TypeError):
                    dep_id = None

            # Assign to a valid exam_id (fallback to first exam if AI hallucinated)
            task_exam_id = task.get("exam_id")
            if task_exam_id not in valid_exam_ids:
                task_exam_id = self.exams[0]["id"] if self.exams else None

            if task_exam_id is None:
                continue

            validated_tasks.append({
                "exam_id": task_exam_id,
                "title": task["title"],
                "topic": task.get("topic", ""),
                "estimated_hours": max(0.5, min(6.0, float(task.get("estimated_hours", 2.0)))),
                "focus_score": fs,
                "reasoning": reasoning,
                "dependency_id": dep_id,
                "sort_order": task.get("sort_order", idx),
            })

        print(
            f"DEBUG ExamBrain.call_split_brain: validated {len(validated_tasks)} tasks, "
            f"{len(gaps)} gaps, {len(topic_map)} exam topic maps"
        )

        return {
            "tasks": validated_tasks,
            "gaps": gaps,
            "topic_map": topic_map,
            "raw_response": raw_response,
        }

    # ------------------------------------------------------------------
    # Strategist helpers (Plan 03)
    # ------------------------------------------------------------------

    def _build_strategist_prompt(self, approved_tasks: list, days_available: int) -> str:
        """Build the system prompt for the Strategist (API Call 2).

        The Strategist distributes approved tasks across available days,
        assigns each task a day_index and internal_priority,
        and generates padding tasks to fill any gaps in the daily quota.

        Args:
            approved_tasks: List of task dicts (each with title, exam_id,
                            estimated_hours, focus_score, reasoning, dependency_id).
            days_available: Number of calendar days until the last exam.

        Returns:
            A prompt string for Claude Haiku.
        """
        neto_h = float(self.user.get("neto_study_hours", 4.0))
        peak = self.user.get("peak_productivity", "Morning")
        task_list_json = json.dumps(approved_tasks, ensure_ascii=False, indent=2)

        return f"""RETURN ONLY VALID JSON — NO TEXT BEFORE OR AFTER.

You are a Strategic Schedule Architect.

STUDENT PROFILE:
- Daily net study quota: {neto_h} hours ({int(neto_h * 60)} minutes)
- Peak productivity window: {peak}
- Days available: {days_available}

APPROVED TASK LIST (with AI reasoning for focus_score):
{task_list_json}

RULES:
1. Distribute ALL tasks across the {days_available} available days. Each task must have a day_index (0 = today, 1 = tomorrow, etc.).
2. Place tasks with focus_score >= 8 in the PEAK productivity window days (prefer earlier in the day when scheduling is determined by the Enforcer).
3. Respect dependency_id: a task must be assigned to an equal or later day than its dependency.
4. Interleave exam subjects across days to prevent burnout. Avoid assigning the same exam for more than 2 consecutive days unless it is the only remaining exam.
5. Assign each task an internal_priority (1-100, where 100 = highest priority). This is used by the Enforcer to trim overflow tasks.
6. PADDING: Calculate the total scheduled task hours. If total task hours < {days_available} * {neto_h} hours, generate padding tasks to close the gap:
   - Use titles like "General Review: [Subject]" or "Solve Practice Problems: [Subject]"
   - Assign padding tasks to exams with the earliest upcoming date
   - Use task_index = -1 for padding tasks and always include title, exam_id, and estimated_hours

RETURN ONLY A VALID JSON ARRAY:
[
  {{
    "task_index": <int, 0-based index into input list, or -1 for padding tasks>,
    "day_index": <int, 0 = today>,
    "internal_priority": <int 1-100>,
    "title": "<string — only set for padding tasks (task_index == -1)>",
    "exam_id": <int — only set for padding tasks>,
    "estimated_hours": <float — only set for padding tasks>
  }}
]"""

    async def call_strategist(self, approved_tasks: list) -> list:
        """Execute the Strategist API Call 2 of the Split-Brain architecture.

        Takes the user-approved task list from the Auditor review, calls Claude
        Haiku once to distribute tasks across available days, and returns a list
        of task objects augmented with day_index and internal_priority.

        Padding tasks (task_index == -1) are constructed as new task dicts and
        appended to the result.

        Args:
            approved_tasks: List of task dicts as approved by the user on the
                            Intermediate Review Page.

        Returns:
            A list of task dicts, each with day_index and internal_priority added.
            Padding tasks are included with a is_padding=True flag.

        Raises:
            RuntimeError: If ANTHROPIC_API_KEY is not set.
        """
        if not self.client:
            raise RuntimeError("ANTHROPIC_API_KEY is not set — cannot run Strategist")

        # Calculate days available until the last exam
        now = datetime.now()
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        days_available = 1
        for exam in self.exams:
            try:
                ed_str = exam["exam_date"].replace("Z", "+00:00")
                exam_date = datetime.fromisoformat(ed_str).replace(tzinfo=None)
                days_until = max(1, (exam_date - today).days)
                days_available = max(days_available, days_until)
            except Exception:
                pass

        prompt = self._build_strategist_prompt(approved_tasks, days_available)
        print(
            f"DEBUG ExamBrain.call_strategist: calling Claude Haiku — "
            f"{len(approved_tasks)} approved tasks, {days_available} days available, "
            f"prompt length {len(prompt)} chars"
        )

        message = self.client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=8000,
            messages=[{"role": "user", "content": prompt}],
        )
        raw_response = message.content[0].text.strip()
        print(f"DEBUG ExamBrain.call_strategist: raw response length {len(raw_response)} chars")

        # Robust JSON parsing: strip markdown fences, find first [ and last ]
        response_text = raw_response
        if response_text.startswith("```"):
            response_text = response_text.split("\n", 1)[1] if "\n" in response_text else response_text[3:]
            response_text = response_text.rsplit("```", 1)[0]

        first_bracket = response_text.find("[")
        last_bracket = response_text.rfind("]")
        if first_bracket != -1 and last_bracket != -1 and last_bracket > first_bracket:
            response_text = response_text[first_bracket: last_bracket + 1]

        try:
            assignments = json.loads(response_text)
        except json.JSONDecodeError as exc:
            print(f"ExamBrain.call_strategist: JSON parse failed — {exc}\nRaw: {raw_response[:500]}")
            assignments = []

        # Map task_index back to actual task objects and augment with scheduling data
        result = []
        seen_task_indices = set()
        fallback_exam_id = self.exams[0]["id"] if self.exams else None

        for item in assignments:
            task_index = item.get("task_index")
            day_index = max(0, int(item.get("day_index", 0)))
            internal_priority = max(1, min(100, int(item.get("internal_priority", 50))))

            if task_index == -1:
                # Padding task — construct a new task dict
                exam_id = item.get("exam_id") or fallback_exam_id
                if not item.get("title"):
                    continue
                padding_task = {
                    "exam_id": exam_id,
                    "title": item["title"],
                    "topic": "Padding",
                    "estimated_hours": max(0.5, min(3.0, float(item.get("estimated_hours", 1.0)))),
                    "focus_score": 3,
                    "reasoning": "Padding task to fill daily study quota.",
                    "dependency_id": None,
                    "sort_order": 9999,
                    "day_index": day_index,
                    "internal_priority": internal_priority,
                    "is_padding": True,
                }
                result.append(padding_task)
            else:
                try:
                    task_index = int(task_index)
                except (ValueError, TypeError):
                    continue

                if task_index < 0 or task_index >= len(approved_tasks):
                    continue

                if task_index in seen_task_indices:
                    continue  # skip duplicate assignments
                seen_task_indices.add(task_index)

                task = dict(approved_tasks[task_index])
                task["day_index"] = day_index
                task["internal_priority"] = internal_priority
                task["is_padding"] = False
                result.append(task)

        # Any tasks not assigned by the Strategist get appended with day_index=0 and low priority
        for idx, task in enumerate(approved_tasks):
            if idx not in seen_task_indices:
                fallback_task = dict(task)
                fallback_task["day_index"] = 0
                fallback_task["internal_priority"] = 10
                fallback_task["is_padding"] = False
                result.append(fallback_task)

        print(
            f"DEBUG ExamBrain.call_strategist: produced {len(result)} scheduled tasks "
            f"(including {sum(1 for t in result if t.get('is_padding'))} padding tasks)"
        )
        return result

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
