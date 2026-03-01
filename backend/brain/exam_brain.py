"""ExamBrain — AI core that builds day-by-day study calendars."""
from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timedelta
import anthropic
import fitz  # PyMuPDF

EXCLUSIVE_ZONE_DAYS = 4
CHAR_LIMIT = 600_000  # ~150K tokens, safe margin under Sonnet's 200K token context


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
        self.client = anthropic.AsyncAnthropic(api_key=api_key) if api_key else None

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
        from datetime import timezone
        tz_offset = self.user.get("timezone_offset", 0) or 0
        local_now = datetime.now(timezone.utc) - timedelta(minutes=tz_offset)
        today = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
        neto_h = float(self.user.get("neto_study_hours", 4.0))
        total = 0.0

        for exam in self.exams:
            try:
                ed_str = exam["exam_date"].replace("Z", "+00:00")
                exam_date = datetime.fromisoformat(ed_str).replace(tzinfo=None)
                days_until = max(1, (exam_date.date() - today.date()).days)
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
2. AGGRESSIVE DECOMPOSITION & BUDGET ENFORCEMENT (CRITICAL):
   - You MUST generate enough tasks so that the sum of their `estimated_hours` equals exactly {total_hours} hours!
   - Break every topic into AT LEAST 3-5 specific sub-tasks.
   - If you finish mapping the core syllabus topics and haven't reached {total_hours} hours, you MUST generate additional deep-practice tasks to fill the remaining budget. Use highly specific titles like: "פתרון מבחן משנים קודמות", "תרגול שאלות קצה בנושא X", or "חזרה אקטיבית על סיכומים של Y". Do not use generic names.
3. SAMPLE EXAMS & PAST EXAMS: If a file is labeled as 'sample_exam' OR 'past_exam', you MUST create two specific tasks for it:
   - "סימולציה מלאה: [File Name] (תנאי אמת, בלי טלפון, עם סטופר)" (estimated 2.5-3h)
   - "תחקור מלא וכתיבת דגשים: [File Name]" (estimated 1.5-2h, dependency on the simulation)
4. REALISTIC TIME ESTIMATION (CRITICAL): 
   - A single question or a small set of exercises should NEVER take 3 hours. 
   - Cap any task that is just "solving question X" or "reviewing problem Y" at 1.0 - 1.5 hours. 
   - Only comprehensive study sessions or full simulations should exceed 2 hours.
5. Actionable Titles: Use the following style for ALL tasks:
   - "מעבר על מצגת: [Topic Name]"
   - "בנייה ידנית: [Core Concept]. תרגול [Operations]"
   - "פתרון שאלות: [Topic]. [Specific Challenges]"
6. Decompose ALL topics into specific, actionable pedagogical tasks with:
   - focus_score (1-10): concentration level required
   - reasoning: 1-sentence explanation
   - dependency_id: index of prerequisite task
   - estimated_hours (0.5 to 3.5 hours)
7. Match the language of the exam name (Hebrew exams -> Hebrew titles).

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

    # ------------------------------------------------------------------
    # Per-exam Auditor helpers (parallel architecture)
    # ------------------------------------------------------------------

    def _build_exam_context_single(self, exam: dict) -> str:
        """Build context string for a single exam only."""
        from server.database import get_db

        db = get_db()
        try:
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

            if not file_texts and exam.get("parsed_context"):
                file_texts.append(f"[LEGACY CONTEXT]\n{exam['parsed_context']}")

            exam_block = exam_header + "\n\n".join(file_texts)
            if len(exam_block) > CHAR_LIMIT:
                exam_block = exam_block[:CHAR_LIMIT] + "\n[TRUNCATED — file too large]"
            return exam_block
        finally:
            db.close()

    def _calculate_exam_hours(self, exam: dict) -> float:
        """Calculate the study hours budget for a single exam."""
        from datetime import timezone
        tz_offset = self.user.get("timezone_offset", 0) or 0
        local_now = datetime.now(timezone.utc) - timedelta(minutes=tz_offset)
        today = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
        neto_h = float(self.user.get("neto_study_hours", 4.0))
        try:
            ed_str = exam["exam_date"].replace("Z", "+00:00")
            exam_date = datetime.fromisoformat(ed_str).replace(tzinfo=None)
            days_until = max(1, (exam_date.date() - today.date()).days)
            return round(days_until * neto_h, 2)
        except Exception:
            return 10.0

    def _build_auditor_prompt_single(self, exam_context: str, exam_hours: float, exam: dict) -> str:
        """Build the Auditor prompt for a single exam."""
        peak = self.user.get("peak_productivity", "Morning")
        exam_id = exam["id"]

        return f"""RETURN ONLY VALID JSON — NO TEXT BEFORE OR AFTER.

You are a Zero-Loss Knowledge Auditor for a university student preparing for ONE exam.

EXAM: {exam['name']} ({exam['subject']}) — Exam ID: {exam_id}

STUDENT PROFILE:
- Study hours budget for this exam: {exam_hours} hours
- Peak productivity window: {peak}

EXAM MATERIAL:
{exam_context}

TASK:
1. Map ALL syllabus topics for this exam.
2. AGGRESSIVE DECOMPOSITION & BUDGET ENFORCEMENT (CRITICAL):
   - You MUST generate enough tasks so that the sum of their `estimated_hours` equals exactly {exam_hours} hours!
   - Break every topic into AT LEAST 3-5 specific sub-tasks.
   - If you finish mapping the core syllabus topics and haven't reached {exam_hours} hours, you MUST generate additional deep-practice tasks to fill the remaining budget. Use highly specific titles like: "פתרון מבחן משנים קודמות", "תרגול שאלות קצה בנושא X", or "חזרה אקטיבית על סיכומים של Y". Do not use generic names.
3. SAMPLE EXAMS & PAST EXAMS: If a file is labeled as 'sample_exam' OR 'past_exam', you MUST create two specific tasks for it:
   - "סימולציה מלאה: [File Name] (תנאי אמת, בלי טלפון, עם סטופר)" (estimated 2.5-3h)
   - "תחקור מלא וכתיבת דגשים: [File Name]" (estimated 1.5-2h, dependency on the simulation)
4. REALISTIC TIME ESTIMATION (CRITICAL): 
   - A single question or a small set of exercises should NEVER take 3 hours. 
   - Cap any task that is just "solving question X" or "reviewing problem Y" at 1.0 - 1.5 hours. 
   - Only comprehensive study sessions or full simulations should exceed 2 hours.
5. Actionable Titles: Use the following style for ALL tasks:
   - "מעבר על מצגת: [Topic Name]"
   - "בנייה ידנית: [Core Concept]. תרגול [Operations]"
   - "פתרון שאלות: [Topic]. [Specific Challenges]"
6. Each task must have:
   - focus_score (1-10): concentration level required
   - reasoning: 1-sentence explanation
   - dependency_id: 0-based index into THIS exam's task array, or null
   - estimated_hours (0.5 to 3.5 hours)
7. Match the language of the exam name (Hebrew exams -> Hebrew titles).

RETURN ONLY VALID JSON — NO TEXT BEFORE OR AFTER:
{{
  "tasks": [
    {{
      "exam_id": {exam_id},
      "title": "<string>",
      "topic": "<string>",
      "estimated_hours": <float 0.5-3.5>,
      "focus_score": <int 1-10>,
      "reasoning": "<string — 1 sentence>",
      "dependency_id": <null or 0-based index into this tasks array>,
      "sort_order": <int>
    }}
  ],
  "gaps": [
    {{
      "exam_id": {exam_id},
      "topic": "<string>",
      "description": "<string>"
    }}
  ],
  "topic_map": {{
    "{exam_id}": ["topic1", "topic2"]
  }}
}}"""

    async def _call_auditor_for_exam(self, exam: dict) -> dict:
        """Run a single Auditor call for one exam. Returns validated tasks, gaps, topic_map."""
        exam_context = self._build_exam_context_single(exam)
        exam_hours = self._calculate_exam_hours(exam)
        prompt = self._build_auditor_prompt_single(exam_context, exam_hours, exam)

        print(
            f"DEBUG ExamBrain._call_auditor_for_exam: exam {exam['id']} ({exam['name']}) — "
            f"{exam_hours}h budget, prompt {len(prompt)} chars"
        )

        message = await self.client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=8192,
            messages=[{"role": "user", "content": prompt}],
        )
        raw_response = message.content[0].text.strip()
        print(
            f"DEBUG ExamBrain._call_auditor_for_exam: exam {exam['id']} — "
            f"raw response {len(raw_response)} chars"
        )

        # Robust JSON parsing
        response_text = raw_response
        if response_text.startswith("```"):
            response_text = response_text.split("\n", 1)[1] if "\n" in response_text else response_text[3:]
            response_text = response_text.rsplit("```", 1)[0]
        first_brace = response_text.find("{")
        last_brace = response_text.rfind("}")
        if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
            response_text = response_text[first_brace: last_brace + 1]

        try:
            result = json.loads(response_text)
        except json.JSONDecodeError as exc:
            print(f"ExamBrain._call_auditor_for_exam: JSON parse failed for exam {exam['id']} — {exc}")
            return {"tasks": [], "gaps": [], "topic_map": {}}

        raw_tasks = result.get("tasks", [])
        validated_tasks = []
        for idx, task in enumerate(raw_tasks):
            if not task.get("title"):
                continue
            fs = task.get("focus_score", 5)
            try:
                fs = max(1, min(10, int(fs)))
            except (ValueError, TypeError):
                fs = 5
            dep_id = task.get("dependency_id")
            if dep_id is not None:
                try:
                    dep_id = int(dep_id)
                    if dep_id < 0 or dep_id >= len(raw_tasks):
                        dep_id = None
                except (ValueError, TypeError):
                    dep_id = None
            validated_tasks.append({
                "task_index": idx,  # local index — remapped after merge
                "exam_id": exam["id"],
                "title": task["title"],
                "topic": task.get("topic", ""),
                "estimated_hours": max(0.5, min(6.0, float(task.get("estimated_hours", 2.0)))),
                "focus_score": fs,
                "reasoning": task.get("reasoning") or "No reasoning provided.",
                "dependency_id": dep_id,
                "sort_order": task.get("sort_order", idx),
            })

        print(
            f"DEBUG ExamBrain._call_auditor_for_exam: exam {exam['id']} — "
            f"{len(validated_tasks)} tasks validated"
        )
        return {
            "tasks": validated_tasks,
            "gaps": result.get("gaps", []),
            "topic_map": result.get("topic_map", {}),
        }

    async def call_split_brain(self) -> dict:
        """Auditor execution: one parallel API call per exam.

        Runs N async Auditor calls concurrently (one per exam), merges results,
        re-indexes task_index and dependency_id globally, then returns the
        combined Auditor output for frontend review.
        """
        if not self.client:
            raise RuntimeError("ANTHROPIC_API_KEY is not set — cannot run Auditor")

        print(f"DEBUG ExamBrain.call_split_brain: launching {len(self.exams)} parallel Auditor calls")
        exam_results = await asyncio.gather(*[
            self._call_auditor_for_exam(exam) for exam in self.exams
        ])

        # Merge all per-exam results with globally unique task_index + remapped dependency_id
        all_tasks = []
        all_gaps = []
        merged_topic_map = {}
        offset = 0
        for result in exam_results:
            exam_tasks = result["tasks"]
            for task in exam_tasks:
                if task.get("dependency_id") is not None:
                    task["dependency_id"] = task["dependency_id"] + offset
                task["task_index"] = offset + exam_tasks.index(task)
            offset += len(exam_tasks)
            all_tasks.extend(exam_tasks)
            all_gaps.extend(result["gaps"])
            merged_topic_map.update(result["topic_map"])

        # Final global re-index (clean up index after list.index() above)
        for i, task in enumerate(all_tasks):
            task["task_index"] = i

        print(
            f"DEBUG ExamBrain.call_split_brain: merged {len(all_tasks)} tasks, "
            f"{len(all_gaps)} gaps across {len(self.exams)} exams"
        )

        return {
            "tasks": all_tasks,
            "gaps": all_gaps,
            "topic_map": merged_topic_map,
            "raw_response": f"[{len(self.exams)} parallel Auditor calls]",
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
        
        # Include current local time if available
        local_time_str = self.user.get("current_local_time", "Not provided")
        sleep_time = self.user.get("sleep_time", "23:00")
        
        # Task 3: Calculate 2-hour buffer
        try:
            now_dt = datetime.strptime(local_time_str, "%H:%M")
            buffer_dt = now_dt + timedelta(hours=2)
            buffer_time_str = buffer_dt.strftime("%H:%M")
        except:
            buffer_time_str = "in 2 hours"

        # Build exam deadlines info
        exams_info = []
        now = datetime.now()
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        for e in self.exams:
            try:
                ed_str = e["exam_date"].replace("Z", "+00:00")
                exam_date = datetime.fromisoformat(ed_str).replace(tzinfo=None)
                days_until = (exam_date.date() - today.date()).days
                exams_info.append(f"- Exam ID {e['id']} ({e['name']}): day_index {days_until}")
            except:
                continue
        exams_info_str = "\n".join(exams_info)

        return f"""RETURN ONLY VALID JSON — NO TEXT BEFORE OR AFTER.

You are a Strategic Schedule Architect.

STUDENT PROFILE:
- Current Local Time: {local_time_str}
- Daily net study quota: {neto_h} hours ({int(neto_h * 60)} minutes)
- Peak productivity window: {peak}
- Days available: {days_available} (day_index 0 is TODAY)
- Sleep time: {sleep_time}

EXAM DEADLINES:
{exams_info_str}

TASKS TO SCHEDULE:
{task_list_json}

RULES:
1. TIME AWARENESS & TODAY'S SCHEDULE (CRITICAL):
   - It is currently {local_time_str}.
   - You MUST schedule the very first tasks for TODAY (day_index 0), starting exactly around {buffer_time_str}.
   - Fill the remaining hours of today until the user's sleep time ({sleep_time}).
   - Do NOT leave today empty unless it is already past sleep time.
   - After finishing today, continue scheduling normally for the following days.
2. STUDY WINDOW: You have {days_available} days to plan.
   - day_index 0 = today
   - Each exam has its own day_index deadline. DO NOT schedule tasks for an exam on or after its day_index.
   - The day_index immediately before an exam is the CRITICAL final study day for that exam.
   - You MUST spread tasks logically across the window. Do not cram everything into Day 0 if you have 7 days available.
3. NO STUDY ON OR AFTER EXAM DAY: Heavy study MUST end the day before the specific exam.
4. Place tasks with focus_score >= 8 in the PEAK productivity window days (prefer earlier in the day when scheduling is determined by the Enforcer).
5. Respect dependency_id: a task must be assigned to an equal or later day than its dependency.
6. Interleave exam subjects across days to prevent burnout. Avoid assigning the same exam for more than 2 consecutive days unless it is the only remaining exam.
7. Assign each task an internal_priority (1-100, where 100 = highest priority).

RETURN ONLY A VALID JSON ARRAY:
[
  {{
    "task_index": <int, 0-based index into input list>,
    "day_index": <int, 0 = today>,
    "internal_priority": <int 1-100>
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
        from datetime import timezone
        tz_offset = self.user.get("timezone_offset", 0) or 0
        local_now = datetime.now(timezone.utc) - timedelta(minutes=tz_offset)
        today_local = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
        
        days_available = 1
        for exam in self.exams:
            try:
                ed_str = exam["exam_date"].replace("Z", "+00:00")
                exam_date = datetime.fromisoformat(ed_str).replace(tzinfo=None)
                # We want the number of days from today until the day BEFORE the exam.
                days_until = (exam_date.date() - today_local.date()).days
                days_available = max(days_available, days_until)
            except Exception:
                pass

        # Calculate local time for the Strategist
        self.user["current_local_time"] = local_now.strftime("%H:%M")

        prompt = self._build_strategist_prompt(approved_tasks, days_available)
        print(
            f"DEBUG ExamBrain.call_strategist: calling Claude Haiku — "
            f"{len(approved_tasks)} approved tasks, {days_available} days available, "
            f"prompt length {len(prompt)} chars"
        )

        message = await self.client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=8192,
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
            raise RuntimeError("AI returned invalid JSON during strategy planning. Please try again.")

        # Map task_index back to actual task objects and augment with scheduling data
        result = []
        seen_task_indices = set()
        fallback_exam_id = self.exams[0]["id"] if self.exams else None

        # Build a lookup for exam deadlines to clamp day_index
        exam_deadlines = {}
        for e in self.exams:
            try:
                ed_str = e["exam_date"].replace("Z", "+00:00")
                exam_date = datetime.fromisoformat(ed_str).replace(tzinfo=None)
                exam_deadlines[e["id"]] = (exam_date.date() - today_local.date()).days
            except:
                continue

        for item in assignments:
            task_index = item.get("task_index")
            
            # Default day_index to 0
            day_index = 0
            try:
                day_index = int(item.get("day_index", 0))
            except (ValueError, TypeError):
                day_index = 0
            
            # Basic range clamp
            day_index = max(0, min(day_index, days_available - 1))
            
            # Clamp based on specific exam deadline
            current_exam_id = None
            if task_index == -1:
                current_exam_id = item.get("exam_id") or fallback_exam_id
            elif isinstance(task_index, int) and 0 <= task_index < len(approved_tasks):
                current_exam_id = approved_tasks[task_index].get("exam_id")
            
            if current_exam_id in exam_deadlines:
                # Study must end AT LEAST 1 day before the exam
                day_index = min(day_index, exam_deadlines[current_exam_id] - 1)
                day_index = max(0, day_index)

            internal_priority = max(1, min(100, int(item.get("internal_priority", 50))))

            if task_index == -1 or task_index is None:
                # Padding task or hallucinated index
                if task_index == -1:
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
                continue

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
