"""Syllabus Parser — Extracts study tasks from PDF using PyMuPDF + Claude AI."""
from __future__ import annotations

import json
import os
import fitz
import anthropic


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    text = ""
    for page in doc:
        text += page.get_text() + "\n"
    doc.close()
    return text


def extract_tasks_with_ai(text: str) -> list[dict]:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not set")

    client = anthropic.Anthropic(api_key=api_key)
    prompt = f"""Analyze this university syllabus/course document and extract all study tasks,
exam dates, and assignments. For each item, provide:
- title: short description
- subject: the course/subject name
- deadline: date in ISO format (YYYY-MM-DD) if mentioned, null if not
- estimated_hours: realistic study hours needed
- difficulty: 1-5 scale

Return ONLY valid JSON — an array of objects. No explanation, no markdown.

Document text:
---
{text[:8000]}
---"""

    message = client.messages.create(
        model="claude-sonnet-4-5-20250929",
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}],
    )
    response_text = message.content[0].text.strip()
    if response_text.startswith("```"):
        response_text = response_text.split("\n", 1)[1]
        response_text = response_text.rsplit("```", 1)[0]
    return json.loads(response_text)


def extract_tasks_from_pdf(pdf_bytes: bytes, user_id: int) -> list[dict]:
    text = extract_text_from_pdf(pdf_bytes)
    if len(text.strip()) < 50:
        raise ValueError("Could not extract enough text from PDF")
    tasks = extract_tasks_with_ai(text)
    for task in tasks:
        task["user_id"] = user_id
    return tasks
