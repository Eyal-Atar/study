"""Syllabus Parser — Extracts study tasks from PDF using PyMuPDF + Claude AI."""
from __future__ import annotations

import json
import os
import fitz
import anthropic


def extract_text_from_pdf(pdf_bytes: bytes, max_pages: int = None) -> str:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    text = ""
    for i, page in enumerate(doc):
        if max_pages is not None and i >= max_pages:
            break
        text += page.get_text() + "\n"
    doc.close()
    return text


def extract_syllabus_context_with_ai(pdf_bytes: bytes) -> dict:
    text = extract_text_from_pdf(pdf_bytes, max_pages=5)
    if len(text.strip()) < 50:
        return {"topics": [], "intensity": 3, "objectives": []}

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        # Fallback if no API key
        return {"topics": [], "intensity": 3, "objectives": ["Syllabus uploaded (no AI analysis)"]}

    client = anthropic.Anthropic(api_key=api_key)
    prompt = f"""Analyze this university syllabus and create a pedagogical digest for study planning.
Focus on:
1. Topics: Key subjects/modules covered.
2. Intensity: 1-5 scale of how demanding the course seems.
3. Objectives: Main learning goals or what the student must master.

Return ONLY valid JSON with keys: "topics" (list), "intensity" (int), "objectives" (list). No explanation.

Syllabus text:
---
{text[:10000]}
---"""

    message = client.messages.create(
        model="claude-3-haiku-20240307",
        max_tokens=1000,
        messages=[{"role": "user", "content": prompt}],
    )
    response_text = message.content[0].text.strip()
    if response_text.startswith("```"):
        response_text = response_text.split("\n", 1)[1]
        response_text = response_text.rsplit("```", 1)[0]
    
    try:
        return json.loads(response_text)
    except:
        return {"topics": [], "intensity": 3, "objectives": ["Failed to parse AI response"]}
