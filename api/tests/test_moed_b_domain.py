"""The Moed B plan builder (S45 decision 5): simulations, weak topics, general review."""

from uuid import UUID, uuid4

from app.domain.moed_b import (
    DEFAULT_REVIEW_TITLE,
    DEFAULT_SIMULATION_TITLE,
    MoedBPlan,
    NewTask,
    SourceTask,
    SourceTopic,
    build_moed_b_tasks,
)
from app.domain.planner import TaskKind, TaskStatus

LEARN = TaskKind.LEARN
PRACTICE = TaskKind.PRACTICE
REVIEW = TaskKind.REVIEW
SIM = TaskKind.SIMULATION
SIM_REVIEW = TaskKind.SIMULATION_REVIEW


def topic(name: str, position: int, weight: int = 3) -> SourceTopic:
    return SourceTopic(id=uuid4(), name=name, weight=weight, position=position)


def task(
    title: str,
    kind: TaskKind,
    minutes: int = 60,
    *,
    topic_id: UUID | None = None,
    position: int | None = None,
    depends_on: UUID | None = None,
    status: TaskStatus = TaskStatus.TODO,
) -> SourceTask:
    return SourceTask(
        id=uuid4(),
        title=title,
        kind=kind,
        minutes=minutes,
        topic_id=topic_id,
        status=status,
        position=position,
        depends_on=depends_on,
    )


def build(
    topics: list[SourceTopic],
    tasks: list[SourceTask],
    weak: list[UUID] | None = None,
    notes: str | None = None,
    budget: int | None = None,
) -> MoedBPlan:
    return build_moed_b_tasks(topics, tasks, weak or [], notes, budget)


def shape(plan: MoedBPlan) -> list[tuple[str, TaskKind, int]]:
    return [(t.title, t.kind, t.minutes) for t in plan.tasks]


def test_keys_are_the_output_order() -> None:
    plan = build([topic("A", 1), topic("B", 2)], [])
    assert [t.key for t in plan.tasks] == list(range(len(plan.tasks)))


def test_without_source_simulations_a_default_pair_comes_first() -> None:
    plan = build([], [])
    assert plan.tasks == (
        NewTask(
            key=0,
            title=DEFAULT_SIMULATION_TITLE,
            kind=SIM,
            minutes=150,
            focus=8,
            topic_id=None,
            depends_on_key=None,
        ),
        NewTask(
            key=1,
            title=DEFAULT_REVIEW_TITLE,
            kind=SIM_REVIEW,
            minutes=60,
            focus=8,
            topic_id=None,
            depends_on_key=0,
        ),
    )
    assert DEFAULT_SIMULATION_TITLE == "Full practice exam"
    assert DEFAULT_REVIEW_TITLE == "Practice exam review"
    assert plan.weak_topic_ids == ()
    assert plan.trimmed == 0


def test_up_to_two_simulations_in_position_order_each_with_its_review() -> None:
    third = task("Sim 3", SIM, 100, position=9)
    first = task("Sim 1", SIM, 120, position=2, status=TaskStatus.DONE)
    second = task("Sim 2", SIM, 90, position=5)
    review_first = task("Review of 1", SIM_REVIEW, 40, position=3, depends_on=first.id)
    # A review of another simulation does not count for the second one.
    review_third = task("Review of 3", SIM_REVIEW, 30, position=10, depends_on=third.id)
    plan = build([], [third, review_third, second, first, review_first])
    assert shape(plan) == [
        ("Sim 1", SIM, 120),
        ("Review of 1", SIM_REVIEW, 40),
        ("Sim 2", SIM, 90),
        (DEFAULT_REVIEW_TITLE, SIM_REVIEW, 60),
    ]
    assert [t.depends_on_key for t in plan.tasks] == [None, 0, None, 2]
    assert all(t.focus == 8 for t in plan.tasks)


def test_a_weak_topic_gets_a_review_then_copies_of_its_practice() -> None:
    a, b = topic("Graphs", 1), topic("Trees", 2, weight=4)
    tasks = [
        task("Learn graphs", LEARN, 100, topic_id=a.id, position=1),
        task("Review graphs", REVIEW, 60, topic_id=a.id, position=2),
        task("BFS drills", PRACTICE, 45, topic_id=a.id, position=3),
        task("DFS drills", PRACTICE, 50, topic_id=a.id, position=4),
        task("Learn trees", LEARN, 300, topic_id=b.id, position=5),
    ]
    plan = build([a, b], tasks, weak=[a.id])
    assert plan.weak_topic_ids == (a.id,)
    weak = plan.tasks[2:5]
    assert [(t.title, t.kind, t.minutes, t.focus, t.topic_id) for t in weak] == [
        ("Graphs", REVIEW, 80, 8, a.id),  # (100 + 60) // 2
        ("BFS drills", PRACTICE, 45, 8, a.id),
        ("DFS drills", PRACTICE, 50, 8, a.id),
    ]
    assert all(t.depends_on_key is None for t in weak)


def test_weak_review_minutes_are_clamped_to_45_120() -> None:
    small, big, empty = topic("S", 1), topic("B", 2), topic("E", 3)
    tasks = [
        task("s", LEARN, 40, topic_id=small.id),
        task("b", LEARN, 600, topic_id=big.id),
        task("b2", REVIEW, 100, topic_id=big.id),
    ]
    plan = build([small, big, empty], tasks, weak=[small.id, big.id, empty.id])
    reviews = [t for t in plan.tasks if t.kind is REVIEW]
    assert [(t.title, t.minutes) for t in reviews] == [("S", 45), ("B", 120), ("E", 45)]


def test_a_weak_topic_without_practice_gets_one_of_60_minutes() -> None:
    a = topic("Probability", 1)
    plan = build([a], [], weak=[a.id])
    assert shape(plan)[2:] == [("Probability", REVIEW, 45), ("Probability", PRACTICE, 60)]
    assert plan.tasks[3].topic_id == a.id


def test_weak_topics_follow_topic_position_not_selection_order() -> None:
    a, b, c = topic("A", 3), topic("B", 1), topic("C", 2)
    plan = build([a, b, c], [], weak=[a.id, b.id])
    assert plan.weak_topic_ids == (b.id, a.id)
    weak_reviews = [t.title for t in plan.tasks if t.kind is REVIEW and t.focus == 8]
    assert weak_reviews == ["B", "A"]


def test_general_review_for_other_topics_depends_on_the_last_weak_task() -> None:
    a, b, c = topic("A", 1, weight=1), topic("B", 2), topic("C", 3, weight=5)
    tasks = [task("A drill", PRACTICE, 30, topic_id=a.id)]
    plan = build([a, b, c], tasks, weak=[a.id])
    assert shape(plan)[2:] == [
        ("A", REVIEW, 45),
        ("A drill", PRACTICE, 30),
        ("B", REVIEW, 75),  # 30 + 15 * 3
        ("C", REVIEW, 105),  # 30 + 15 * 5
    ]
    last_weak = plan.tasks[3].key
    general = plan.tasks[4:]
    assert [t.depends_on_key for t in general] == [last_weak, last_weak]
    assert [t.focus for t in general] == [5, 5]
    assert [t.topic_id for t in general] == [b.id, c.id]


def test_without_weak_topics_general_review_has_no_dependency() -> None:
    a, b = topic("B", 2, weight=2), topic("A", 1)
    plan = build([a, b], [])
    assert shape(plan)[2:] == [("A", REVIEW, 75), ("B", REVIEW, 60)]
    assert [t.depends_on_key for t in plan.tasks[2:]] == [None, None]
    assert plan.weak_topic_ids == ()


def test_notes_pick_topics_by_full_name_case_insensitively() -> None:
    a, b, c = topic("  Dynamic Programming ", 1), topic("Greedy", 2), topic("Heaps", 3)
    plan = build([a, b, c], [], notes="Honestly dynamic programming was the worst. Heap too")
    assert plan.weak_topic_ids == (a.id,)  # "Heap" is not the full name "Heaps"
    assert plan.tasks[2].title == "Dynamic Programming"


def test_notes_match_hebrew_names_and_join_the_selection() -> None:
    a, b, c = topic("הסתברות מותנית", 1), topic("שונות", 2), topic("גרפים", 3)
    plan = build([a, b, c], [], weak=[c.id], notes="היה קשה בשאלה על הסתברות מותנית.")
    assert plan.weak_topic_ids == (a.id, c.id)


def test_a_selected_id_that_is_not_a_topic_is_ignored() -> None:
    a = topic("A", 1)
    plan = build([a], [], weak=[uuid4()])
    assert plan.weak_topic_ids == ()
    assert shape(plan)[2:] == [("A", REVIEW, 75)]


def test_a_duplicate_selection_counts_once() -> None:
    a = topic("A", 1)
    plan = build([a], [], weak=[a.id, a.id], notes="a")
    assert plan.weak_topic_ids == (a.id,)
    assert [t.title for t in plan.tasks].count("A") == 2  # one review, one practice


def test_without_topics_each_learn_task_gets_a_half_length_review() -> None:
    tasks = [
        task("Chapter 2", LEARN, 90, position=2),
        task("Chapter 1", LEARN, 40, position=1),
        task("Drill", PRACTICE, 60, position=3),
        task("Chapter 3", LEARN, 301, position=4, status=TaskStatus.DONE),
    ]
    plan = build([], tasks, notes="chapter 1")
    assert shape(plan)[2:] == [
        ("Chapter 1", REVIEW, 30),
        ("Chapter 2", REVIEW, 45),
        ("Chapter 3", REVIEW, 150),
    ]
    assert all(t.focus == 5 and t.depends_on_key is None for t in plan.tasks[2:])
    assert plan.weak_topic_ids == ()


def test_budget_drops_general_review_from_the_end() -> None:
    a, b, c, d = topic("A", 1), topic("B", 2), topic("C", 3), topic("D", 4)
    # Default simulations 210, weak A 45 + 60 = 105, general B, C, D 75 each: 540.
    plan = build([a, b, c, d], [], weak=[a.id], budget=400)
    assert [t.title for t in plan.tasks][4:] == ["B"]
    assert plan.trimmed == 2
    assert [t.key for t in plan.tasks] == list(range(5))


def test_budget_that_fits_drops_nothing() -> None:
    a = topic("A", 1)
    plan = build([a], [], budget=285)  # 210 + 75
    assert plan.trimmed == 0
    assert len(plan.tasks) == 3


def test_budget_never_drops_simulations_or_weak_tasks() -> None:
    a, b = topic("A", 1), topic("B", 2)
    plan = build([a, b], [], weak=[a.id], budget=10)
    assert shape(plan) == [
        (DEFAULT_SIMULATION_TITLE, SIM, 150),
        (DEFAULT_REVIEW_TITLE, SIM_REVIEW, 60),
        ("A", REVIEW, 45),
        ("A", PRACTICE, 60),
    ]
    assert plan.trimmed == 1


def test_no_budget_means_no_trimming() -> None:
    topics = [topic(f"T{i}", i) for i in range(1, 30)]
    plan = build(topics, [], budget=None)
    assert plan.trimmed == 0
    assert len(plan.tasks) == 2 + 29


def test_minutes_and_titles_fit_the_task_checks() -> None:
    sim = task("  " + "x" * 250 + "  ", SIM, 3)
    review = task("r", SIM_REVIEW, 900, depends_on=sim.id)
    plan = build([], [sim, review])
    assert plan.tasks[0].title == "x" * 200
    assert plan.tasks[0].minutes == 5
    assert plan.tasks[1].minutes == 600


def test_long_topic_names_are_truncated_to_200() -> None:
    # Topic names are at most 120 in the database; the builder still guards.
    a = SourceTopic(id=uuid4(), name="n" * 300, weight=1, position=1)
    plan = build([a], [], weak=[a.id])
    assert plan.tasks[2].title == "n" * 200


def test_the_default_practice_exam_fits_in_a_study_day() -> None:
    plan = build_moed_b_tasks([], [], [], None, None, max_simulation_minutes=120)
    assert [(t.kind, t.minutes) for t in plan.tasks[:1]] == [(TaskKind.SIMULATION, 120)]
    roomy = build_moed_b_tasks([], [], [], None, None, max_simulation_minutes=240)
    assert roomy.tasks[0].minutes == 150


def test_a_short_name_never_matches_inside_a_longer_word() -> None:
    c, ab = topic("C", 1), topic("AB", 2)
    plan = build([c, ab], [], notes="C and AB were fine, but recursion was hard")
    assert plan.weak_topic_ids == ()


def test_a_name_matches_only_as_a_whole_word_in_any_occurrence() -> None:
    graphs, trees = topic("Graphs", 1), topic("Trees", 2)
    plan = build(
        [graphs, trees], [], notes="the graphs part was hard, subgraphsx no; forest of Trees2"
    )
    assert plan.weak_topic_ids == (graphs.id,)
    # The first occurrence is inside a word, a later one stands alone.
    plan = build([graphs], [], notes="subgraphs are fine, the graphs part is not")
    assert plan.weak_topic_ids == (graphs.id,)


def test_a_hebrew_name_matches_next_to_punctuation() -> None:
    graphs = topic("גרפים", 1)
    plan = build([graphs], [], notes="היה קשה: גרפים, ועצים")
    assert plan.weak_topic_ids == (graphs.id,)


def test_weak_topics_are_capped_at_50_selected_first_then_notes() -> None:
    topics = [topic(f"Topic number {i:03d}", i) for i in range(1, 53)]
    selected = [t.id for t in topics[1:51]]  # 2..51
    plan = build(topics, [], weak=selected, notes="Topic number 001 and Topic number 052")
    assert len(plan.weak_topic_ids) == 50
    assert set(plan.weak_topic_ids) == set(selected)
    plan = build(topics, [], weak=selected[:49], notes="Topic number 001 and Topic number 052")
    assert len(plan.weak_topic_ids) == 50
    assert topics[0].id in plan.weak_topic_ids and topics[51].id not in plan.weak_topic_ids
