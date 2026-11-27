"""The student profile library and its strict loader.

``eval/profiles.json`` is the only source of profile values. Unknown or missing keys are
errors, and error messages carry only the profile id and a field name, never text taken
from the file.
"""

import datetime as dt
import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final, Literal, cast

from app.domain.planner import Commitment, Interval, Profile, StudyWindow
from eval.bank.cases import _Reader
from eval.bank.clock import NOW, TZ
from eval.bank.paths import PROFILES_FILE

GROUPS: Final = ("student", "timeline", "gap")
GAPS: Final = ("max_block_minutes", "exam_extra_time_percent")
SITTINGS: Final = ("a", "moed_b")

_ID_RE: Final = re.compile(r"^[a-z][a-z0-9_]{2,59}$")
_TIME_RE: Final = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_REQUIRED: Final = (
    "id",
    "group",
    "wake",
    "sleep",
    "daily_study_minutes",
    "study_windows",
    "rest_days_before_exam",
    "study_start_delay_minutes",
    "commitments",
    "busy",
)
_OPTIONAL: Final = ("timeline", "gap", "gap_value")


class ProfileError(ValueError):
    """A profile violates the schema. Messages hold the profile id and field only."""


@dataclass(frozen=True, slots=True, kw_only=True)
class Timeline:
    days_to_exam: int | None = None  # overrides course.days_to_exam
    exam_offsets_days: tuple[int, ...] = ()  # several exams (marathon); overrides days_to_exam
    sitting: Literal["a", "moed_b"] = "a"


@dataclass(frozen=True, slots=True, kw_only=True)
class EvalProfile:
    id: str
    group: Literal["student", "timeline", "gap"]
    profile: Profile  # built for NOW
    timeline: Timeline
    gap: str | None  # "max_block_minutes" | "exam_extra_time_percent" | None
    gap_value: int | None


class _ProfileReader(_Reader):
    """The case reader, failing with ProfileError."""

    def fail(self, field: str) -> ProfileError:  # type: ignore[override]
        return ProfileError(f"profile {self.case_id}: invalid field {field}")

    def clock(self, value: object, field: str) -> dt.time:
        text = self.pattern(value, field, _TIME_RE)
        return dt.time(int(text[:2]), int(text[3:]))


def _commitments(r: _ProfileReader, raw: object) -> tuple[Commitment, ...]:
    result: list[Commitment] = []
    for i, item in enumerate(r.items(raw, "commitments", 0, 20)):
        f = f"commitments[{i}]"
        d = r.obj(item, f, ("weekdays", "start", "end"))
        start = r.clock(d["start"], f"{f}.start")
        end = r.clock(d["end"], f"{f}.end")
        for day in r.items(d["weekdays"], f"{f}.weekdays", 1, 7):
            weekday = r.integer(day, f"{f}.weekdays", 0, 6)
            try:
                result.append(
                    Commitment(weekday=weekday, start=start, end=end, valid_from=NOW.date())
                )
            except ValueError as exc:
                raise r.fail(f) from exc
    return tuple(result)


def _busy(r: _ProfileReader, raw: object) -> tuple[Interval, ...]:
    result: list[Interval] = []
    for i, item in enumerate(r.items(raw, "busy", 0, 20)):
        f = f"busy[{i}]"
        d = r.obj(item, f, ("from_day", "days"))
        first = NOW.date() + dt.timedelta(days=r.integer(d["from_day"], f"{f}.from_day", 0, 365))
        last = first + dt.timedelta(days=r.integer(d["days"], f"{f}.days", 1, 365))
        start = dt.datetime.combine(first, dt.time(), tzinfo=TZ)
        end = dt.datetime.combine(last, dt.time(), tzinfo=TZ)
        result.append(Interval(start=start.astimezone(dt.UTC), end=end.astimezone(dt.UTC)))
    return tuple(result)


def _timeline(r: _ProfileReader, raw: object) -> Timeline:
    if raw is None:
        return Timeline()
    if not isinstance(raw, dict):
        raise r.fail("timeline")
    data = cast("dict[str, Any]", raw)
    if not set(data) <= {"days_to_exam", "exam_offsets_days", "sitting"}:
        raise r.fail("timeline")
    days = data.get("days_to_exam")
    offsets = data.get("exam_offsets_days", [])
    return Timeline(
        days_to_exam=None if days is None else r.integer(days, "timeline.days_to_exam", 1, 120),
        exam_offsets_days=tuple(
            r.integer(o, "timeline.exam_offsets_days", 1, 120)
            for o in r.items(offsets, "timeline.exam_offsets_days", 0, 12)
        ),
        sitting=cast(
            "Literal['a', 'moed_b']",
            r.choice(data.get("sitting", "a"), "timeline.sitting", SITTINGS),
        ),
    )


def _profile(raw: object, index: int) -> EvalProfile:
    ident = raw.get("id") if isinstance(raw, dict) else None
    r = _ProfileReader(ident if isinstance(ident, str) and _ID_RE.match(ident) else f"#{index}")
    if not isinstance(raw, dict):
        raise r.fail("profile")
    data = cast("dict[str, Any]", raw)
    if not set(_REQUIRED) <= set(data) <= {*_REQUIRED, *_OPTIONAL}:
        raise r.fail("profile")
    profile_id = r.pattern(data["id"], "id", _ID_RE)
    group = r.choice(data["group"], "group", GROUPS)
    windows = r.items(data["study_windows"], "study_windows", 1, 4)
    gap_raw = data.get("gap")
    gap = None if gap_raw is None else r.choice(gap_raw, "gap", GAPS)
    value_raw = data.get("gap_value")
    gap_value = None if value_raw is None else r.integer(value_raw, "gap_value", 1, 1000)
    if (gap is None) != (gap_value is None):
        raise r.fail("gap_value")
    try:
        profile = Profile(
            timezone=TZ,
            wake_time=r.clock(data["wake"], "wake"),
            sleep_time=r.clock(data["sleep"], "sleep"),
            daily_study_minutes=r.integer(
                data["daily_study_minutes"], "daily_study_minutes", 30, 960
            ),
            study_windows=frozenset(
                StudyWindow(r.choice(w, "study_windows", [m.value for m in StudyWindow]))
                for w in windows
            ),
            rest_days_before_exam=r.integer(
                data["rest_days_before_exam"], "rest_days_before_exam", 0, 14
            ),
            study_start_delay=dt.timedelta(
                minutes=r.integer(
                    data["study_start_delay_minutes"], "study_start_delay_minutes", 0, 360
                )
            ),
            commitments=_commitments(r, data["commitments"]),
            busy=_busy(r, data["busy"]),
        )
    except ValueError as exc:
        if isinstance(exc, ProfileError):
            raise
        raise r.fail("profile") from exc
    return EvalProfile(
        id=profile_id,
        group=cast("Literal['student', 'timeline', 'gap']", group),
        profile=profile,
        timeline=_timeline(r, data.get("timeline")),
        gap=gap,
        gap_value=gap_value,
    )


def load_profiles(path: Path = PROFILES_FILE, *, now: dt.datetime = NOW) -> tuple[EvalProfile, ...]:
    """Load and validate the profile file, in file order, built for ``now``."""
    if now != NOW:
        raise ProfileError("profiles: only the fixed evaluation clock is supported")
    try:
        raw: object = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ProfileError("profiles: unreadable file") from exc
    if (
        not isinstance(raw, dict)
        or set(raw) != {"schema", "profiles"}
        or raw["schema"] != 1
        or isinstance(raw["schema"], bool)
        or not isinstance(raw["profiles"], list)
    ):
        raise ProfileError("profiles: invalid structure")
    profiles = tuple(_profile(p, i) for i, p in enumerate(raw["profiles"]))
    ids = [p.id for p in profiles]
    if len(set(ids)) != len(ids):
        raise ProfileError("profiles: duplicate id")
    return profiles


def profile_by_id(profiles: Sequence[EvalProfile], profile_id: str) -> EvalProfile:
    """The profile with this id; raises ProfileError (never KeyError) when absent."""
    for p in profiles:
        if p.id == profile_id:
            return p
    raise ProfileError(f"profile {profile_id}: not found")


__all__ = [
    "EvalProfile",
    "ProfileError",
    "Timeline",
    "load_profiles",
    "profile_by_id",
]
