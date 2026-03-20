"""ExamBrain — AI core that builds day-by-day study calendars."""
from __future__ import annotations
import asyncio
import json
import os
import random
import time
from datetime import datetime, timedelta, timezone
import litellm
import fitz  # PyMuPDF

async def retry_acompletion(model, messages, **kwargs):
    """Wrapper for litellm.acompletion with exponential backoff retry logic."""
    max_retries = 3
    base_delay = 2 # seconds

    for attempt in range(max_retries):
        try:
            return await litellm.acompletion(model=model, messages=messages, **kwargs)
        except Exception as e:
            # Handle rate limits (429) or overloaded servers (503/529)
            error_str = str(e).lower()
            is_retryable = any(msg in error_str for msg in ["429", "rate limit", "overloaded", "503", "529", "timeout"])

            if attempt < max_retries - 1 and is_retryable:
                # Calculate delay with jitter: base_delay * 2^attempt + jitter
                delay = (base_delay * (2 ** attempt)) + (random.uniform(0, 1))
                print(f"DEBUG: AI Call failed (attempt {attempt+1}/{max_retries}). Retrying in {delay:.2f}s... Error: {e}")
                await asyncio.sleep(delay)
            else:
                print(f"ERROR: AI Call failed after {attempt+1} attempts: {e}")
                raise e

CHAR_LIMIT = 700_000

class ExamBrain:
    @staticmethod
    def extract_pdf_text(file_path: str, max_pages: int | None = None) -> str:
        """Extract text from a PDF file using PyMuPDF (fitz)."""
        try:
            doc = fitz.open(file_path)
            text = ""
            for i, page in enumerate(doc):
                if max_pages is not None and i >= max_pages:
                    break
                text += page.get_text() + "\n"
            doc.close()
            return text.strip()
        except Exception as e:
            print(f"WARNING: PDF extraction failed for {file_path}: {e}")
            return ""

    def __init__(self, user: dict, exams: list[dict]):
        self.user = user
        self.exams = exams
        self.model = os.environ.get("LLM_MODEL", "openrouter/openai/gpt-4o-mini")

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
                if not file_texts and exam["parsed_context"]:
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
                print(f"ExamBrain._calculate_total_hours: skipping exam {exam['id']}: {e}")
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

            if not file_texts and exam["parsed_context"]:
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
2. MATERIAL-BASED ANCHORING (CRITICAL):
   - "Review" Task: If a 'syllabus' or 'summary' file exists, you MUST create exactly one task: "סקירה ראשונית: [Filename/Topic]" (estimated 1.5h, topic="review").
   - "Simulation" Tasks: 
     - If 'past_exam' or 'sample_exam' files exist, for EACH file create: "סימולציה מלאה: [Filename]" (estimated 3.0h, topic="simulation") AND "תחקור סימולציה: [Filename]" (estimated 1.5h, topic="review", depends on its simulation).
     - NUDGE: If NO 'past_exam' or 'sample_exam' files exist, you MUST still create at least two generic tasks: "סימולציה מלאה (חיפוש ופתרון מבחן לדוגמה)" (3.0h, topic="simulation") and "תחקור סימולציה" (1.5h, topic="review").
3. AGGRESSIVE DECOMPOSITION & BUDGET ENFORCEMENT (CRITICAL):
   - You MUST generate enough tasks so that the sum of their `estimated_hours` equals exactly {exam_hours} hours (including simulations/reviews)!
   - Break every topic into AT LEAST 3-5 specific sub-tasks.
   - If you haven't reached {exam_hours} hours, generate additional deep-practice tasks. Use highly specific titles.
4. REALISTIC TIME ESTIMATION (CRITICAL): 
   - A single question should NEVER take 3 hours. 
   - Cap generic study tasks at 1.0 - 1.5 hours. 
   - Only full simulations should be 3.0 hours.
5. Actionable Titles: Use the style:
   - "מעבר על מצגת: [Topic Name]"
   - "פתרון שאלות: [Topic]. [Specific Challenges]"
6. Each task must have:
   - topic: set to "simulation" for simulations, "review" for reviews/audits, or the actual subject topic for study tasks.
   - focus_score (1-10): concentration level required.
   - reasoning: 1-sentence explanation.
   - dependency_id: 0-based index into THIS exam's task array, or null.
   - estimated_hours (0.5 to 3.5 hours).
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

        # Force Density Instruction added to User Message
        user_message = f"Generate the Knowledge Audit for Exam {exam['id']} ({exam['name']}). \n\nCRITICAL: You must generate a HIGH-DENSITY list of tasks. For this amount of syllabus material, I expect at least 40-60 granular sub-tasks to be generated to fill the {exam_hours} hour budget."

        response = await retry_acompletion(
            model=self.model,
            messages=[{"role": "user", "content": prompt + "\n\n" + user_message}],
            max_tokens=8192,
            temperature=0,
            response_format={"type": "json_object"}
        )
        raw_response = response.choices[0].message.content.strip()
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
        print(f"DEBUG ExamBrain.call_split_brain: launching {len(self.exams)} parallel Auditor calls")
        exam_results = await asyncio.gather(*[
            self._call_auditor_for_exam(exam) for exam in self.exams
        ], return_exceptions=True)

        # Merge all per-exam results with globally unique task_index + remapped dependency_id
        all_tasks = []
        all_gaps = []
        merged_topic_map = {}
        offset = 0
        for i, result in enumerate(exam_results):
            if isinstance(result, Exception):
                print(f"WARNING ExamBrain.call_split_brain: exam {self.exams[i]['id']} failed: {result}")
                continue
            exam_tasks = result["tasks"]
            for idx, task in enumerate(exam_tasks):
                if task.get("dependency_id") is not None:
                    task["dependency_id"] = task["dependency_id"] + offset
                task["task_index"] = offset + idx
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
        """Build the system prompt for the Strategist (API Call 2)."""
        neto_h = float(self.user.get("neto_study_hours", 4.0))
        peak = self.user.get("peak_productivity", "Morning")
        buffer_days = int(self.user.get("buffer_days", 1))
        
        # Minimized task list for the prompt
        minimized_tasks = []
        for t in approved_tasks:
            minimized_tasks.append({
                "i": t.get("task_index"),
                "h": t.get("estimated_hours"),
                "f": t.get("focus_score"),
                "e": t.get("exam_id"),
                "d": t.get("dependency_id"),
                "t": t.get("topic") # Include topic for anchoring
            })
        task_list_json = json.dumps(minimized_tasks, ensure_ascii=False)
        
        local_time_str = self.user.get("current_local_time", "Not provided")
        sleep_time = self.user.get("sleep_time", "23:00")
        
        exams_info = []
        tz_offset = self.user.get("timezone_offset", 0) or 0
        _local_now = datetime.now(timezone.utc) - timedelta(minutes=tz_offset)
        today = _local_now.replace(hour=0, minute=0, second=0, microsecond=0)
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
- Daily net study quota: {neto_h} hours
- Peak productivity window: {peak}
- Buffer days: {buffer_days} (Student wants {buffer_days} full days off BEFORE the exam date)
- Days available: {days_available} (day_index 0 is TODAY)
- Sleep time: {sleep_time}

EXAM DEADLINES (day_index):
{exams_info_str}

TASKS TO SCHEDULE (i=index, h=hours, f=focus, e=exam_id, d=dependency, t=topic):
{task_list_json}

STRATEGIC RULES (CRITICAL):
1. ANCHORING:
   - Topic "simulation": MUST be placed as late as possible, closest to the exam date (but before the buffer days).
   - Topic "review": MUST be placed as early as possible (the first day study begins for that exam).
2. BUFFER DAYS: For an exam at day_index X, NO tasks for that exam should be scheduled on day_indices [X-{buffer_days} to X-1]. All study for that exam must end by X-{buffer_days+1}.
3. SINGLE FOCUS: Try to group tasks for the same exam on the same day(s) to minimize context switching.
4. FILL QUOTA: Distribute tasks so they fill the daily {neto_h}h quota.
5. FOCUS SCORE: focus_score >= 8 should be placed in peak windows (high priority for early slots in the day).
6. DEPENDENCIES: Respect dependencies strictly.

RETURN FORMAT:
{{
  "schedule": [
    [task_index, day_index, priority],
    ...
  ]
}}"""

    async def call_strategist(self, approved_tasks: list) -> list:
        """Execute the Strategist API Call 2 of the Split-Brain architecture."""
        from datetime import timezone
        tz_offset = self.user.get("timezone_offset", 0) or 0
        local_now = datetime.now(timezone.utc) - timedelta(minutes=tz_offset)
        
        days_available = 1
        for exam in self.exams:
            try:
                ed_str = exam["exam_date"].replace("Z", "+00:00")
                exam_date = datetime.fromisoformat(ed_str)
                days_until = (exam_date.date() - local_now.date()).days
                days_available = max(days_available, days_until)
            except Exception:
                pass

        self.user["current_local_time"] = local_now.strftime("%H:%M")

        prompt = self._build_strategist_prompt(approved_tasks, days_available)
        print(f"DEBUG ExamBrain.call_strategist: calling {self.model} with {len(approved_tasks)} tasks")

        response = await retry_acompletion(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=8192,
            temperature=0,
            response_format={"type": "json_object"}
        )
        raw_response = response.choices[0].message.content.strip()
        print(f"DEBUG ExamBrain.call_strategist: raw response length {len(raw_response)} chars")

        try:
            data = json.loads(raw_response)
            assignments = data.get("schedule", [])
        except json.JSONDecodeError as exc:
            print(f"ExamBrain.call_strategist: JSON parse failed — {exc}\nRaw: {raw_response[:500]}")
            raise RuntimeError("AI returned invalid JSON during strategy planning. Please try again.")

        result = []
        seen_task_indices = set()
        fallback_exam_id = self.exams[0]["id"] if self.exams else None

        exam_deadlines = {}
        for e in self.exams:
            try:
                ed_str = e["exam_date"].replace("Z", "+00:00")
                exam_date = datetime.fromisoformat(ed_str)
                exam_deadlines[e["id"]] = (exam_date.date() - local_now.date()).days
            except:
                continue

        for item in assignments:
            if not isinstance(item, list) or len(item) < 3:
                continue
            
            task_index, day_index, internal_priority = item[0], item[1], item[2]
            
            try:
                day_index = int(day_index)
                task_index = int(task_index)
                internal_priority = int(internal_priority)
            except (ValueError, TypeError):
                continue

            day_index = max(0, min(day_index, days_available - 1))
            
            current_exam_id = None
            if task_index == -1:
                # Padding handling (if any returned in this format)
                continue 
            elif 0 <= task_index < len(approved_tasks):
                current_exam_id = approved_tasks[task_index].get("exam_id")
            
            if current_exam_id in exam_deadlines:
                day_index = min(day_index, exam_deadlines[current_exam_id] - 1)
                day_index = max(0, day_index)

            internal_priority = max(1, min(100, internal_priority))

            if task_index < 0 or task_index >= len(approved_tasks):
                continue

            if task_index in seen_task_indices:
                continue
            seen_task_indices.add(task_index)

            task = dict(approved_tasks[task_index])
            task["day_index"] = day_index
            task["internal_priority"] = internal_priority
            task["is_padding"] = False
            result.append(task)

        for idx, task in enumerate(approved_tasks):
            if idx not in seen_task_indices:
                fallback_task = dict(task)
                fallback_task["day_index"] = 0
                fallback_task["internal_priority"] = 10
                fallback_task["is_padding"] = False
                result.append(fallback_task)

        print(f"DEBUG ExamBrain.call_strategist: produced {len(result)} scheduled tasks")
        return result

    def _generate_basic_calendar(self, exam_contexts: list[dict]) -> list[dict]:
        """Generate a day-by-day calendar from exam dates (no AI needed)."""
        tasks = []
        now = datetime.now(timezone.utc)
        tz_offset = self.user.get("timezone_offset", 0) or 0
        local_now = now - timedelta(minutes=tz_offset)
        today = local_now.replace(hour=0, minute=0, second=0, microsecond=0)

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
