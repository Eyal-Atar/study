"""Tests for the boards: case x profile x fill (S46a Task 3)."""

import datetime as dt
import re

import pytest

from app.domain.planner import TaskKind, plan
from eval.bank.boards import FILLS, Board, build_board, build_boards, planner_tasks
from eval.bank.cases import load_cases
from eval.bank.clock import NOW, stable_id
from eval.bank.profiles import load_profiles, profile_by_id
from eval.bank.tasklists import ListTask, ListTopic, TaskList

BOARD_ID = re.compile(r"^[a-z0-9][a-z0-9_:.\-]{0,79}$")


def _saved(index: int) -> TaskList:
    return TaskList(
        id=f"saved:demo{index}:model",
        source="saved",
        course_type="problem_solving",
        topics=(ListTopic(key="t01", weight=3), ListTopic(key="t02", weight=2)),
        tasks=(
            ListTask(
                key="k001", kind=TaskKind.LEARN, minutes=60, focus=7, depends_on=None, topic="t01"
            ),
            ListTask(
                key="k002",
                kind=TaskKind.PRACTICE,
                minutes=60,
                focus=8,
                depends_on="k001",
                topic="t01",
            ),
            ListTask(
                key="k003", kind=TaskKind.LEARN, minutes=60, focus=7, depends_on=None, topic="t02"
            ),
            ListTask(
                key="k004",
                kind=TaskKind.PRACTICE,
                minutes=60,
                focus=8,
                depends_on="k003",
                topic="t02",
            ),
            ListTask(
                key="k005",
                kind=TaskKind.SIMULATION,
                minutes=120,
                focus=9,
                depends_on=None,
                topic=None,
            ),
        ),
        exam_minutes=None,
        budget=1500,
    )


def _all() -> tuple[Board, ...]:
    return build_boards(load_cases(), (_saved(1), _saved(2)), load_profiles())


def test_board_counts() -> None:
    cases = load_cases()
    profiles = load_profiles()
    assert len(cases) == 12
    assert len(profiles) == 11
    assert FILLS == (0.5, 1.0)
    boards = _all()
    assert len(boards) == 12 * 11 * 2 + 2 * 11 == 286
    ids = [b.id for b in boards]
    assert len(set(ids)) == len(ids)
    assert all(BOARD_ID.match(i) for i in ids)
    first = boards[0]
    assert first.id == f"{cases[0].id}:f50:{profiles[0].id}"
    assert first.list_id == f"{cases[0].id}:f50"
    # Order: case, profile (file order), fill; then the saved lists.
    assert boards[1].list_id == f"{cases[0].id}:f100"
    assert boards[1].profile_id == profiles[0].id
    assert boards[2].list_id == f"{cases[0].id}:f50"
    assert boards[2].profile_id == profiles[1].id
    assert boards[11 * 2].list_id == f"{cases[1].id}:f50"
    assert boards[12 * 11 * 2].source == "saved"
    assert boards[12 * 11 * 2].fill is None
    assert boards[12 * 11 * 2].id == f"saved:demo1:model:{profiles[0].id}"


def test_duplicate_board_ids_are_an_error() -> None:
    saved = _saved(1)
    with pytest.raises(RuntimeError):
        build_boards((), (saved, saved), load_profiles())


def test_marathon_has_six_exams_with_own_topics() -> None:
    cases = load_cases()
    profiles = load_profiles()
    case = next(c for c in cases if c.id.startswith("s01"))
    board = build_board(case, profile_by_id(profiles, "marathon"), fill=1.0)
    assert len(board.exams) == 6
    assert len({e.id for e in board.exams}) == 6
    assert [e.exam_date for e in board.exams] == sorted(e.exam_date for e in board.exams)
    per_exam: dict[object, set[object]] = {}
    for ref in board.topics.values():
        per_exam.setdefault(ref.exam_id, set()).add(ref.id)
    assert len(per_exam) == 6
    all_ids = [ref.id for ref in board.topics.values()]
    assert len(set(all_ids)) == len(all_ids)  # topics are never shared between exams
    assert {t.exam_id for t in board.tasks} <= {e.id for e in board.exams}


def test_timeline_overrides_days() -> None:
    cases = load_cases()
    case = next(c for c in cases if c.id.startswith("s01"))
    board = build_board(case, profile_by_id(load_profiles(), "late_starter_4d"), fill=0.5)
    assert [e.exam_date for e in board.exams] == [dt.date(2026, 12, 10)]
    plain = build_board(case, profile_by_id(load_profiles(), "full_time"), fill=0.5)
    assert plain.exams[0].exam_date == NOW.date() + dt.timedelta(days=case.course.days_to_exam)
    assert plain.now == NOW
    assert plain.exams[0].difficulty == 3
    assert plain.exams[0].id == stable_id(plain.id, "exam", 0)


def test_saved_board_exam_is_35_days_out() -> None:
    board = build_board(_saved(1), profile_by_id(load_profiles(), "full_time"), fill=None)
    assert [e.exam_date for e in board.exams] == [NOW.date() + dt.timedelta(days=35)]
    assert board.course_type == "problem_solving"
    assert board.exam_minutes is None


def test_every_topic_task_is_mapped() -> None:
    profiles = load_profiles()
    for board in _all()[::7]:
        for task in board.tasks:
            if task.kind in (TaskKind.LEARN, TaskKind.PRACTICE):
                topic_id = board.task_topic[task.id]
                assert board.topics[topic_id].exam_id == task.exam_id
                assert board.topics[topic_id].has_tasks
    assert profiles  # the sample above is not empty
    assert len(_all()[::7]) > 30


def test_missing_topic_in_map_without_tasks() -> None:
    cases = load_cases()
    case = next(c for c in cases if c.id.startswith("s03"))
    assert case.expect.missing_topic == "t12"
    board = build_board(case, profile_by_id(load_profiles(), "full_time"), fill=1.0)
    exam = board.exams[0]
    expected = stable_id(board.id, 0, "topic", "t12")
    assert expected in board.topics
    ref = board.topics[expected]
    assert ref.key == "t12"
    assert ref.exam_id == exam.id
    assert not ref.has_tasks
    assert expected not in set(board.task_topic.values())
    assert board.topics[stable_id(board.id, 0, "topic", "t01")].has_tasks


def test_gap_fields_come_from_the_profile() -> None:
    case = next(c for c in load_cases() if c.id.startswith("s01"))
    profile = profile_by_id(load_profiles(), "adhd")
    board = build_board(case, profile, fill=1.0)
    assert board.gap == profile.gap
    assert board.gap_value == profile.gap_value
    assert board.gap is not None
    assert board.exam_minutes == case.course.exam_minutes


def test_moed_b_board_uses_moed_b_tasks() -> None:
    case = next(c for c in load_cases() if c.id.startswith("s03"))
    board = build_board(case, profile_by_id(load_profiles(), "moed_b"), fill=1.0)
    assert board.tasks
    # Moed B tasks come from the product builder: no learn task, ids derived from b-keys.
    assert not [t for t in board.tasks if t.kind is TaskKind.LEARN]
    assert board.tasks[0].id == stable_id(board.id, 0, "b000")
    assert board.topics[stable_id(board.id, 0, "topic", "t12")].has_tasks is False


def test_boards_are_deterministic() -> None:
    first = _all()
    second = _all()
    assert [b.id for b in first] == [b.id for b in second]
    assert [b.tasks for b in first] == [b.tasks for b in second]
    assert [b.exams for b in first] == [b.exams for b in second]


def test_plan_runs_on_every_board() -> None:
    boards = _all()
    assert len(boards) == 286
    for board in boards:
        result = plan(board.profile, board.exams, planner_tasks(board), (), board.now)
        assert result is not None
