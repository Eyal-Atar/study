"""How far each exam's current sitting got: what the closure sheet and the archive show (S45).

Only the exam's current sitting counts (`tasks.sitting = exams.sitting`), and only live tasks.
A skipped task is out of the total: the user decided it was not needed. "Studied" is the
real time of the done blocks; the completion percent is by the tasks' estimated minutes,
so one long task counts more than a short one (plan S45, decision 11).
"""

from collections.abc import Collection
from dataclasses import dataclass
from uuid import UUID

from app.domain.closure import completion_percent
from app.services.profiles import Conn


@dataclass(frozen=True)
class ExamStats:
    studied_minutes: int
    tasks_done: int
    tasks_total: int
    completion_percent: int


EMPTY = ExamStats(studied_minutes=0, tasks_done=0, tasks_total=0, completion_percent=0)


def exam_stats(conn: Conn, user_id: UUID, exam_ids: Collection[UUID]) -> dict[UUID, ExamStats]:
    """The stats of each of the user's exams in exam_ids (an exam with no task gets EMPTY)."""
    if not exam_ids:
        return {}
    rows = conn.execute(
        """
        SELECT e.id,
               coalesce(sum(t.estimated_minutes) FILTER (WHERE t.status = 'done'), 0)
                   AS done_estimate,
               coalesce(sum(t.estimated_minutes) FILTER (WHERE t.status IN ('todo', 'done')), 0)
                   AS total_estimate,
               count(t.id) FILTER (WHERE t.status = 'done') AS tasks_done,
               count(t.id) FILTER (WHERE t.status IN ('todo', 'done')) AS tasks_total,
               coalesce((
                   SELECT sum(extract(epoch FROM b.ends_at - b.starts_at))::bigint / 60
                   FROM app.blocks AS b
                   JOIN app.tasks AS bt ON bt.id = b.task_id AND bt.user_id = b.user_id
                   WHERE b.user_id = e.user_id
                     AND b.status = 'done'
                     AND bt.exam_id = e.id
                     AND bt.sitting = e.sitting
                     AND bt.deleted_at IS NULL
               ), 0) AS studied_minutes
        FROM app.exams AS e
        LEFT JOIN app.tasks AS t
            ON t.exam_id = e.id AND t.user_id = e.user_id
           AND t.sitting = e.sitting AND t.deleted_at IS NULL
        WHERE e.user_id = %(user_id)s AND e.id = ANY(%(ids)s)
        GROUP BY e.id
        """,
        {"user_id": user_id, "ids": list(exam_ids)},
    ).fetchall()
    return {
        row["id"]: ExamStats(
            studied_minutes=int(row["studied_minutes"]),
            tasks_done=int(row["tasks_done"]),
            tasks_total=int(row["tasks_total"]),
            completion_percent=completion_percent(
                int(row["done_estimate"]), int(row["total_estimate"])
            ),
        )
        for row in rows
    }
