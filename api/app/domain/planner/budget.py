"""How many study minutes each exam gets (the input of the course analysis)."""

import datetime as dt
from collections.abc import Sequence
from uuid import UUID

from app.domain.planner.availability import last_study_day, study_days
from app.domain.planner.model import Exam, Profile


def _share_day(cap: int, weights: Sequence[int]) -> list[int]:
    """Split cap by weight with the largest remainder method; ties go to the earlier index."""
    total = sum(weights)
    parts = [cap * weight // total for weight in weights]
    remainders = [cap * weight % total for weight in weights]
    order = sorted(range(len(weights)), key=lambda i: (-remainders[i], i))
    for index in order[: cap - sum(parts)]:
        parts[index] += 1
    return parts


def exam_budgets(profile: Profile, exams: Sequence[Exam], now: dt.datetime) -> dict[UUID, int]:
    """Study minutes per exam: each study day's minutes are shared by difficulty among
    the exams whose last study day has not passed.

    A day's minutes are the daily budget, but never more than its windows hold. Every
    exam has a key, 0 when no study day is left for it.
    """
    budgets = {exam.id: 0 for exam in exams}
    last = [last_study_day(exam, profile) for exam in exams]
    for day in study_days(profile, exams, now):
        cap = min(profile.daily_study_minutes, sum(window.minutes for window in day.windows))
        active = [i for i, exam_last in enumerate(last) if day.date <= exam_last]
        if not active or cap == 0:
            continue
        shares = _share_day(cap, [exams[i].difficulty for i in active])
        for i, share in zip(active, shares, strict=True):
            budgets[exams[i].id] += share
    return budgets
