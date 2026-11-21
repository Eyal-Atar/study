"""The focused plan of a Moed B round, built from Moed A's topics and tasks (S45). Pure.

No Claude call: the exam already has topics (S11), Moed A's tasks carry their kind, topic
and minutes, and the new date has a budget (`exam_budgets`). That is enough for a
deterministic plan, in this order (decision 5 of the S45 plan):

1. Simulations: up to two of Moed A's, each followed by its review (Moed A's review of it,
   or a default one). Without any, one default simulation and its review.
2. Weak topics (chosen, or named in the free text): a review titled the topic, half of its
   Moed A learn and review minutes (45-120), then copies of its practice tasks (or one
   practice of 60 minutes).
3. General review: one review per other topic, 30 + 15 * weight minutes. Each depends on the
   last weak task, so the planner (which places review before practice) does not move it
   ahead of the weak topics' practice. Without topics, one review per Moed A learn task.

Over the budget, general review is dropped from the end; simulations and weak topics never
are (what does not fit is reported as an ordinary shortfall). The output order is the
position order of the new tasks.
"""

from collections.abc import Collection, Iterable, Sequence
from dataclasses import dataclass
from typing import Final
from uuid import UUID

from app.domain.planner import TaskKind, TaskStatus

DEFAULT_SIMULATION_TITLE: Final = "Full practice exam"
DEFAULT_SIMULATION_MINUTES: Final = 150
DEFAULT_REVIEW_TITLE: Final = "Practice exam review"
DEFAULT_REVIEW_MINUTES: Final = 60
MAX_SIMULATIONS: Final = 2
MAX_WEAK_TOPICS: Final = 50
MIN_MATCH_NAME: Final = 3

WEAK_FOCUS: Final = 8
GENERAL_FOCUS: Final = 5
WEAK_REVIEW_MIN: Final = 45
WEAK_REVIEW_MAX: Final = 120
WEAK_PRACTICE_MINUTES: Final = 60
GENERAL_BASE_MINUTES: Final = 30
GENERAL_MINUTES_PER_WEIGHT: Final = 15
LEARN_REVIEW_MIN: Final = 30

# The CHECKs of app.tasks (migration 0002).
MIN_MINUTES: Final = 5
MAX_MINUTES: Final = 600
MAX_TITLE: Final = 200


@dataclass(frozen=True, slots=True, kw_only=True)
class SourceTopic:
    id: UUID
    name: str
    weight: int
    position: int


@dataclass(frozen=True, slots=True, kw_only=True)
class SourceTask:
    """A live task of Moed A."""

    id: UUID
    title: str
    kind: TaskKind
    minutes: int
    topic_id: UUID | None
    status: TaskStatus
    position: int | None
    depends_on: UUID | None


@dataclass(frozen=True, slots=True, kw_only=True)
class NewTask:
    """A task to create; key is its index in the plan, depends_on_key an earlier one's."""

    key: int
    title: str
    kind: TaskKind
    minutes: int
    focus: int
    topic_id: UUID | None
    depends_on_key: int | None


@dataclass(frozen=True, slots=True)
class MoedBPlan:
    tasks: tuple[NewTask, ...]
    # The weak topics the plan used, in topic position order.
    weak_topic_ids: tuple[UUID, ...]
    # How many general review tasks the budget dropped.
    trimmed: int


@dataclass(slots=True)
class _Draft:
    title: str
    kind: TaskKind
    minutes: int
    focus: int
    topic_id: UUID | None
    # An index into the draft list, resolved to a key at the end.
    depends_on: int | None = None
    general: bool = False


def _minutes(value: int) -> int:
    return max(MIN_MINUTES, min(MAX_MINUTES, value))


def _title(value: str) -> str:
    return value.strip()[:MAX_TITLE]


def _by_position(tasks: Iterable[SourceTask]) -> list[SourceTask]:
    # Stable: tasks without a position keep their input order, after those with one.
    return sorted(tasks, key=lambda t: (t.position is None, t.position or 0))


def _mentioned(name: str, text: str) -> bool:
    """Whether the topic's full name stands in the notes as its own word(s).

    The name (casefolded, stripped) needs at least MIN_MATCH_NAME characters, so "C" does not
    match "recursion". Every occurrence is checked: the characters just before and after must
    not be letters or digits, so "Graph" does not match "Graphs" but "Graphs" matches "the
    graphs part". Known limit: Hebrew prefixes ("בגרפים") are attached to the word and do not
    match; the user then picks the topic in the list.
    """
    if len(name) < MIN_MATCH_NAME:
        return False
    start = text.find(name)
    while start != -1:
        end = start + len(name)
        before_ok = start == 0 or not text[start - 1].isalnum()
        after_ok = end == len(text) or not text[end].isalnum()
        if before_ok and after_ok:
            return True
        start = text.find(name, start + 1)
    return False


def _weak_topics(
    topics: Sequence[SourceTopic], selected: Collection[UUID], notes: str | None
) -> list[SourceTopic]:
    """The weak topics, at most MAX_WEAK_TOPICS (the exams_moed_b_topic_ids_shape CHECK).

    The selected topics come first, then those the notes mention, each group in topic position
    order; when there are more than the cap, the later ones are left out. The result is
    returned in topic position order.
    """
    text = (notes or "").casefold()
    wanted = set(selected)
    chosen = [t for t in topics if t.id in wanted]
    mentioned = [
        t for t in topics if t.id not in wanted and _mentioned(t.name.strip().casefold(), text)
    ]
    keep = {t.id for t in [*chosen, *mentioned][:MAX_WEAK_TOPICS]}
    return [t for t in topics if t.id in keep]


def _simulations(tasks: Sequence[SourceTask], max_minutes: int | None) -> list[_Draft]:
    ordered = _by_position(tasks)
    simulations = [t for t in ordered if t.kind is TaskKind.SIMULATION][:MAX_SIMULATIONS]
    drafts: list[_Draft] = []
    if not simulations:
        drafts.append(
            _Draft(
                DEFAULT_SIMULATION_TITLE,
                TaskKind.SIMULATION,
                # A simulation never splits, so the default one must fit in a study day.
                DEFAULT_SIMULATION_MINUTES
                if max_minutes is None
                else max(MIN_MINUTES, min(DEFAULT_SIMULATION_MINUTES, max_minutes)),
                WEAK_FOCUS,
                None,
            )
        )
        drafts.append(
            _Draft(
                DEFAULT_REVIEW_TITLE,
                TaskKind.SIMULATION_REVIEW,
                DEFAULT_REVIEW_MINUTES,
                WEAK_FOCUS,
                None,
                depends_on=0,
            )
        )
        return drafts
    for simulation in simulations:
        index = len(drafts)
        drafts.append(
            _Draft(
                simulation.title,
                TaskKind.SIMULATION,
                simulation.minutes,
                WEAK_FOCUS,
                simulation.topic_id,
            )
        )
        review = next(
            (
                t
                for t in ordered
                if t.kind is TaskKind.SIMULATION_REVIEW and t.depends_on == simulation.id
            ),
            None,
        )
        drafts.append(
            _Draft(
                DEFAULT_REVIEW_TITLE if review is None else review.title,
                TaskKind.SIMULATION_REVIEW,
                DEFAULT_REVIEW_MINUTES if review is None else review.minutes,
                WEAK_FOCUS,
                simulation.topic_id if review is None else review.topic_id,
                depends_on=index,
            )
        )
    return drafts


def _weak_drafts(topic: SourceTopic, tasks: Sequence[SourceTask]) -> list[_Draft]:
    own = [t for t in _by_position(tasks) if t.topic_id == topic.id]
    studied = sum(t.minutes for t in own if t.kind in (TaskKind.LEARN, TaskKind.REVIEW))
    review_minutes = max(WEAK_REVIEW_MIN, min(WEAK_REVIEW_MAX, studied // 2))
    drafts = [_Draft(topic.name, TaskKind.REVIEW, review_minutes, WEAK_FOCUS, topic.id)]
    practice = [t for t in own if t.kind is TaskKind.PRACTICE]
    if practice:
        drafts.extend(
            _Draft(t.title, TaskKind.PRACTICE, t.minutes, WEAK_FOCUS, topic.id) for t in practice
        )
    else:
        drafts.append(
            _Draft(topic.name, TaskKind.PRACTICE, WEAK_PRACTICE_MINUTES, WEAK_FOCUS, topic.id)
        )
    return drafts


def build_moed_b_tasks(
    topics: Sequence[SourceTopic],
    tasks: Sequence[SourceTask],
    weak_topic_ids: Collection[UUID],
    notes: str | None,
    budget_minutes: int | None,
    *,
    max_simulation_minutes: int | None = None,
) -> MoedBPlan:
    """The new tasks of a Moed B round, in position order (see the module docstring).

    `tasks` are Moed A's live tasks, any status. Ids in weak_topic_ids that are not one of
    `topics` are ignored (the caller rejects them first). `max_simulation_minutes` (the
    user's daily study minutes) caps the default practice exam, which never splits.
    """
    ordered_topics = sorted(topics, key=lambda t: t.position)
    weak = _weak_topics(ordered_topics, weak_topic_ids, notes)
    weak_ids = {t.id for t in weak}

    drafts = _simulations(tasks, max_simulation_minutes)
    for topic in weak:
        drafts.extend(_weak_drafts(topic, tasks))
    last_weak = len(drafts) - 1 if weak else None

    if ordered_topics:
        general = [
            _Draft(
                topic.name,
                TaskKind.REVIEW,
                GENERAL_BASE_MINUTES + GENERAL_MINUTES_PER_WEIGHT * topic.weight,
                GENERAL_FOCUS,
                topic.id,
                depends_on=last_weak,
                general=True,
            )
            for topic in ordered_topics
            if topic.id not in weak_ids
        ]
    else:
        general = [
            _Draft(
                t.title,
                TaskKind.REVIEW,
                max(LEARN_REVIEW_MIN, t.minutes // 2),
                GENERAL_FOCUS,
                t.topic_id,
                general=True,
            )
            for t in _by_position(tasks)
            if t.kind is TaskKind.LEARN
        ]
    drafts.extend(general)

    trimmed = 0
    if budget_minutes is not None:
        total = sum(_minutes(d.minutes) for d in drafts)
        while total > budget_minutes and drafts and drafts[-1].general:
            total -= _minutes(drafts.pop().minutes)
            trimmed += 1

    new_tasks = tuple(
        NewTask(
            key=key,
            title=_title(draft.title),
            kind=draft.kind,
            minutes=_minutes(draft.minutes),
            focus=draft.focus,
            topic_id=draft.topic_id,
            depends_on_key=draft.depends_on,
        )
        for key, draft in enumerate(drafts)
    )
    return MoedBPlan(tasks=new_tasks, weak_topic_ids=tuple(t.id for t in weak), trimmed=trimmed)
