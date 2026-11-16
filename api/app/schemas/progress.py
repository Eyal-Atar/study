"""GET /progress and the progress field of complete/uncomplete (S19)."""

import datetime as dt

from pydantic import BaseModel

from app.domain.gamification import MAX_LEVEL
from app.services.gamification import ProgressChange, ProgressView


class ProgressChangeOut(BaseModel):
    """What one complete or uncomplete changed; S17/S18 show it in the "done" toast."""

    xp_change: int
    total_xp: int
    level: int
    level_up: bool
    badges_earned: list[str]
    badges_lost: list[str]

    @classmethod
    def from_change(cls, change: ProgressChange) -> ProgressChangeOut:
        return cls(
            xp_change=change.xp_change,
            total_xp=change.total_xp,
            level=change.level,
            level_up=change.level_up,
            badges_earned=list(change.badges_earned),
            badges_lost=list(change.badges_lost),
        )


class StreakOut(BaseModel):
    current: int
    longest: int
    studied_today: bool
    today: dt.date


class DayXpOut(BaseModel):
    date: dt.date
    xp: int


class BadgeOut(BaseModel):
    key: str
    group: str
    threshold: int
    earned: bool
    earned_at: dt.datetime | None


class ProgressResponse(BaseModel):
    total_xp: int
    level: int
    level_start_xp: int
    next_level_xp: int | None
    max_level: int
    blocks_done: int
    streak: StreakOut
    days: list[DayXpOut]
    badges: list[BadgeOut]

    @classmethod
    def from_view(cls, view: ProgressView) -> ProgressResponse:
        return cls(
            total_xp=view.total_xp,
            level=view.level,
            level_start_xp=view.level_start_xp,
            next_level_xp=view.next_level_xp,
            max_level=MAX_LEVEL,
            blocks_done=view.blocks_done,
            streak=StreakOut(
                current=view.streak.current,
                longest=view.streak.longest,
                studied_today=view.streak.studied_today,
                today=view.today,
            ),
            days=[DayXpOut(date=day.date, xp=day.xp) for day in view.days],
            badges=[
                BadgeOut(
                    key=state.badge.key,
                    group=state.badge.group.value,
                    threshold=state.badge.threshold,
                    earned=state.earned_at is not None,
                    earned_at=state.earned_at,
                )
                for state in view.badges
            ],
        )
