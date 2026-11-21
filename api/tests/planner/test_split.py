from datetime import date

import pytest

from app.domain.planner import PlannerInputError, TaskKind
from app.domain.planner.split import bite_for
from tests.planner.factories import make_exam, make_task

EXAM = make_exam(date(2026, 12, 1))


@pytest.mark.parametrize(
    ("block", "bite"),
    [
        (30, None),
        (59, None),
        (60, 30),
        (75, 30),
        (89, 30),
        (90, 30),
        (104, 30),
        (105, 35),
        (120, 40),
        (180, 60),
        (600, 200),
    ],
)
def test_bite_for(block: int, bite: int | None) -> None:
    assert bite_for(block) == bite


@pytest.mark.parametrize("bite", [29, 301, 0])
def test_a_bite_outside_30_to_300_is_refused(bite: int) -> None:
    with pytest.raises(PlannerInputError):
        make_task(EXAM, 90, TaskKind.PRACTICE, bite_minutes=bite)


def test_a_bool_bite_is_refused() -> None:
    with pytest.raises(PlannerInputError):
        make_task(EXAM, 90, TaskKind.PRACTICE, bite_minutes=True)


def test_no_bite_by_default() -> None:
    task = make_task(EXAM, 90, TaskKind.PRACTICE)
    assert task.bite_minutes is None
