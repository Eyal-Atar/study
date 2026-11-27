"""Case structure and its validating loader.

A case is a directory ``eval/cases/<id>/`` holding ``case.json``. Validation is
strict: unknown keys are errors, and error messages carry only the case id and
the field name, never text taken from the file.
"""

import json
import re
from collections.abc import Collection, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final, Literal, cast

from eval.bank.paths import CASES_DIR, MATERIALS_DIR

COURSE_TYPES: Final = (
    "problem_solving",
    "programming",
    "mcq_memorization",
    "essay",
    "open_book",
    "language",
    "quantitative_social",
    "oral",
    "take_home",
)
FORMATS: Final = (
    "problems",
    "programming",
    "mcq",
    "open",
    "essay",
    "open_book",
    "oral",
    "take_home",
    "mixed",
)
LANGUAGES: Final = ("he", "ar", "en")
MATERIAL_KINDS: Final = (
    "syllabus",
    "summary",
    "past_exam",
    "solution",
    "notes",
    "other",
    "exercises",
)
CASE_KINDS: Final = ("synthetic", "real", "trap")
ORIGINS: Final = ("synthetic", "real")
KNOWN_KINDS: Final = (
    "learn",
    "practice",
    "review",
    "simulation",
    "simulation_review",
    "custom",
    "recall",
    "final_review",
    "read",
    "write",
    "summary",
)
MUST_NOT_CODES: Final = ("simulation_shorter_than_ratio",)

_ID_RE: Final = re.compile(r"^[a-z][a-z0-9_]{2,59}$")
_TOPIC_KEY_RE: Final = re.compile(r"^t\d{2}$")
_SLUG_RE: Final = re.compile(r"^[a-z][a-z0-9_]{0,59}$")


class CaseError(ValueError):
    """A case violates the schema. Messages hold the case id and field only."""


@dataclass(frozen=True, slots=True, kw_only=True)
class CaseTopic:
    key: str
    name: str
    weight: int


@dataclass(frozen=True, slots=True, kw_only=True)
class CaseMaterial:
    path: str
    kind: str
    origin: Literal["synthetic", "real"]


@dataclass(frozen=True, slots=True, kw_only=True)
class CourseInfo:
    name: str
    type: str
    format: str
    language: str
    exam_minutes: int
    days_to_exam: int
    difficulty: int


@dataclass(frozen=True, slots=True, kw_only=True)
class MustNot:
    code: str
    ratio: float


@dataclass(frozen=True, slots=True, kw_only=True)
class Expect:
    topics: tuple[CaseTopic, ...]
    missing_topic: str | None
    format: str | None
    language: str | None
    exam_minutes: int | None
    kinds_min: Mapping[str, int]
    must_not: tuple[MustNot, ...]


@dataclass(frozen=True, slots=True, kw_only=True)
class Case:
    id: str
    kind: Literal["synthetic", "real", "trap"]
    course: CourseInfo
    materials: tuple[CaseMaterial, ...]
    profile: str
    expect: Expect
    notes_code: str | None
    dir: Path


class _Reader:
    """Typed accessors that raise CaseError naming the case id and field."""

    def __init__(self, case_id: str) -> None:
        self.case_id = case_id

    def fail(self, field: str) -> CaseError:
        return CaseError(f"case {self.case_id}: invalid field {field}")

    def obj(self, value: object, field: str, keys: Collection[str]) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise self.fail(field)
        data = cast("dict[str, Any]", value)
        if set(data) != set(keys):
            # Both unknown and missing keys are violations.
            raise self.fail(field)
        return data

    def integer(self, value: object, field: str, lo: int, hi: int) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
            raise self.fail(field)
        return value

    def text(self, value: object, field: str, lo: int = 1, hi: int = 120) -> str:
        if not isinstance(value, str) or not lo <= len(value) <= hi:
            raise self.fail(field)
        return value

    def choice(self, value: object, field: str, allowed: Collection[str]) -> str:
        if not isinstance(value, str) or value not in allowed:
            raise self.fail(field)
        return value

    def pattern(self, value: object, field: str, regex: re.Pattern[str]) -> str:
        if not isinstance(value, str) or regex.match(value) is None:
            raise self.fail(field)
        return value

    def items(self, value: object, field: str, lo: int, hi: int) -> list[Any]:
        if not isinstance(value, list) or not lo <= len(value) <= hi:
            raise self.fail(field)
        return value


def _material(r: _Reader, raw: object, index: int) -> CaseMaterial:
    field = f"materials[{index}]"
    d = r.obj(raw, field, ("path", "kind", "origin"))
    path = r.text(d["path"], f"{field}.path", 1, 200)
    if path.startswith("/") or ".." in Path(path).parts or "\\" in path:
        raise r.fail(f"{field}.path")
    origin = r.choice(d["origin"], f"{field}.origin", ORIGINS)
    return CaseMaterial(
        path=path,
        kind=r.choice(d["kind"], f"{field}.kind", MATERIAL_KINDS),
        origin=cast("Literal['synthetic', 'real']", origin),
    )


def _expect(r: _Reader, raw: object) -> Expect:
    d = r.obj(
        raw,
        "expect",
        (
            "topics",
            "missing_topic",
            "format",
            "language",
            "exam_minutes",
            "kinds_min",
            "must_not",
        ),
    )
    topics: list[CaseTopic] = []
    for i, item in enumerate(r.items(d["topics"], "expect.topics", 1, 20)):
        f = f"expect.topics[{i}]"
        t = r.obj(item, f, ("key", "name", "weight"))
        topics.append(
            CaseTopic(
                key=r.pattern(t["key"], f"{f}.key", _TOPIC_KEY_RE),
                name=r.text(t["name"], f"{f}.name"),
                weight=r.integer(t["weight"], f"{f}.weight", 1, 5),
            )
        )
    keys = [t.key for t in topics]
    if len(set(keys)) != len(keys):
        raise r.fail("expect.topics")
    missing = d["missing_topic"]
    if missing is not None and (not isinstance(missing, str) or missing not in keys):
        raise r.fail("expect.missing_topic")
    fmt = None if d["format"] is None else r.choice(d["format"], "expect.format", FORMATS)
    lang = None if d["language"] is None else r.choice(d["language"], "expect.language", LANGUAGES)
    minutes = (
        None
        if d["exam_minutes"] is None
        else r.integer(d["exam_minutes"], "expect.exam_minutes", 10, 4320)
    )
    raw_kinds = d["kinds_min"]
    if not isinstance(raw_kinds, dict):
        raise r.fail("expect.kinds_min")
    kinds_min: dict[str, int] = {}
    for k, v in raw_kinds.items():
        kinds_min[r.choice(k, "expect.kinds_min", KNOWN_KINDS)] = r.integer(
            v, "expect.kinds_min", 1, 10_000
        )
    must_not: list[MustNot] = []
    for i, item in enumerate(r.items(d["must_not"], "expect.must_not", 0, 20)):
        f = f"expect.must_not[{i}]"
        m = r.obj(item, f, ("code", "ratio"))
        ratio = m["ratio"]
        if isinstance(ratio, bool) or not isinstance(ratio, (int, float)) or not 0 <= ratio <= 1:
            raise r.fail(f"{f}.ratio")
        must_not.append(
            MustNot(code=r.choice(m["code"], f"{f}.code", MUST_NOT_CODES), ratio=float(ratio))
        )
    return Expect(
        topics=tuple(topics),
        missing_topic=missing,
        format=fmt,
        language=lang,
        exam_minutes=minutes,
        kinds_min=kinds_min,
        must_not=tuple(must_not),
    )


def load_case(path: Path, *, check_files: bool = False) -> Case:
    """Load and validate one ``case.json``; with ``check_files`` also its materials."""
    case_dir = path.parent
    r = _Reader(case_dir.name)
    try:
        raw: object = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise CaseError(f"case {case_dir.name}: unreadable case.json") from exc
    d = r.obj(
        raw,
        "case",
        (
            "schema",
            "id",
            "kind",
            "course",
            "materials",
            "profile",
            "expect",
            "notes_code",
        ),
    )
    if d["schema"] != 1 or isinstance(d["schema"], bool):
        raise r.fail("schema")
    case_id = r.pattern(d["id"], "id", _ID_RE)
    if case_id != case_dir.name:
        raise r.fail("id")
    kind = r.choice(d["kind"], "kind", CASE_KINDS)
    c = r.obj(
        d["course"],
        "course",
        (
            "name",
            "type",
            "format",
            "language",
            "exam_minutes",
            "days_to_exam",
            "difficulty",
        ),
    )
    course = CourseInfo(
        name=r.text(c["name"], "course.name"),
        type=r.choice(c["type"], "course.type", COURSE_TYPES),
        format=r.choice(c["format"], "course.format", FORMATS),
        language=r.choice(c["language"], "course.language", LANGUAGES),
        exam_minutes=r.integer(c["exam_minutes"], "course.exam_minutes", 10, 4320),
        days_to_exam=r.integer(c["days_to_exam"], "course.days_to_exam", 1, 120),
        difficulty=r.integer(c["difficulty"], "course.difficulty", 1, 5),
    )
    materials = tuple(
        _material(r, m, i) for i, m in enumerate(r.items(d["materials"], "materials", 0, 100))
    )
    profile = r.pattern(d["profile"], "profile", _SLUG_RE)
    expect = _expect(r, d["expect"])
    notes = d["notes_code"]
    notes_code = None if notes is None else r.pattern(notes, "notes_code", _SLUG_RE)
    if check_files:
        for i, m in enumerate(materials):
            base = case_dir if m.origin == "synthetic" else MATERIALS_DIR
            if not (base / m.path).is_file():
                raise r.fail(f"materials[{i}].path")
    return Case(
        id=case_id,
        kind=cast("Literal['synthetic', 'real', 'trap']", kind),
        course=course,
        materials=materials,
        profile=profile,
        expect=expect,
        notes_code=notes_code,
        dir=case_dir,
    )


def load_cases(
    root: Path = CASES_DIR,
    *,
    kinds: Collection[str] | None = None,
    check_files: bool = False,
) -> tuple[Case, ...]:
    """Load every ``<root>/<id>/case.json``, sorted by id, optionally by kind."""
    cases = [
        load_case(p / "case.json", check_files=check_files)
        for p in sorted(root.iterdir())
        if p.is_dir() and (p / "case.json").is_file()
    ]
    if kinds is not None:
        cases = [c for c in cases if c.kind in kinds]
    return tuple(sorted(cases, key=lambda c: c.id))
