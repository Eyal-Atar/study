"""Exam closure and Moed B: closure columns on exams, tasks.sitting, plan_versions.exam_before

Explicit SQL, written by hand.

An exam is one course that goes through at most two sittings (Moed A, then possibly Moed B),
so the state lives on the `exams` row rather than in a table of sittings: every reader of
exams (the planner, review, export, account deletion, RLS) already works on that row, and the
state is one more `WHERE` condition, with no join and no new RLS, export, deletion or undo.

`app.exams` gains:

1. `sitting smallint NOT NULL DEFAULT 1`, 1 or 2. Existing exams are first sittings. There is
   no third sitting (Moed C): widening the CHECK later adds it without breaking anything.
2. `closure` (NULL, 'done' or 'moed_b') and `closed_at`, always set together. "Pending
   closure" is not stored: it depends on the clock and the user's time zone, so
   `app/domain/closure.py` derives it (19:00 local time on the exam date). Only the decision
   is stored. 'moed_b' is allowed only at sitting 1; at sitting 2 the only closure is 'done'.
3. `closure_notified_at`: when the one closure push was sent (S45 Task 4). Opening Moed B
   clears it, so the second sitting gets its own push.
4. What must be kept from Moed A when the date changes, allowed only at sitting 2:
   `first_exam_date` (required exactly when sitting = 2), `first_grade` (0-100, optional),
   `moed_b_notes` (what was hard, free text, 1-1000 characters, not blank) and
   `moed_b_topic_ids` (the topics chosen as hard, at most 50, one-dimensional, no NULL
   element). The ids are not a foreign key (Postgres has none for array elements); the API
   checks them against the exam's own topics, and a deleted topic is simply skipped.
   `array_ndims` of an empty array is NULL, so the shape CHECK accepts NULL ndims as the
   empty array.
5. The partial index `exams_closure_due_idx (exam_date)` for the push scan: it runs across all
   users every minute and only wants exams that are open, not yet notified and not deleted.

`app.tasks` gains `sitting smallint NOT NULL DEFAULT 1` (1 or 2; existing tasks are 1). The
planner takes only the tasks whose sitting equals their exam's, so Moed A's tasks (done or
not) stay as history when Moed B gets new ones. The BEFORE INSERT trigger `tasks_set_sitting`
sets a new task's sitting to its exam's, whatever the INSERT says, so every path that creates
tasks (manual, analysis, Moed B) is right without a change to its code. An exam that does not
exist (or is another user's) gives 1, and the foreign key then rejects the row. Like 0013's
`exams_assign_color`, the function runs as the caller (no SECURITY DEFINER): RLS shows the
user's own exams, which are exactly the ones it may read. `SET search_path = ''` as in 0004,
0010 and 0013.

`app.plan_versions` gains `exam_before`, the exam's fields before a closure or a Moed B
opening (closure, closed_at, sitting, exam_date, ...), like `task_before` and
`busy_event_before`: undo restores them, while the snapshot holds only blocks. The INSERT
column grant was last set in 0014; it is re-issued with `exam_before` added, and the
downgrade restores 0014's list.

Grants on `exams` and `tasks` are table-wide (0002), so the new columns need no GRANT. Account
deletion is unchanged: `app.delete_account_data()` already deletes exams, tasks and
plan_versions.

Downgrade drops `tasks.sitting`, so the Moed A tasks (todo ones included) of an exam that is at
sitting 2 would be plannable again.
"""

from alembic import op

revision = "0016"
# S44's 0015 comes before this; re-point down_revision to "0015" when it lands.
down_revision = "0013"
branch_labels = None
depends_on = None

_PLAN_VERSIONS_INSERT_0014 = (
    "user_id, reason, snapshot, exam_id, task_id, task_before, analysis_id, block_id, "
    "busy_event_id, busy_event_before"
)


def upgrade() -> None:
    op.execute("""
        ALTER TABLE app.exams
            ADD COLUMN sitting smallint NOT NULL DEFAULT 1,
            ADD COLUMN closure text,
            ADD COLUMN closed_at timestamptz,
            ADD COLUMN closure_notified_at timestamptz,
            ADD COLUMN first_exam_date date,
            ADD COLUMN first_grade smallint,
            ADD COLUMN moed_b_notes text,
            ADD COLUMN moed_b_topic_ids uuid[] NOT NULL DEFAULT '{}',
            ADD CONSTRAINT exams_sitting_valid CHECK (sitting IN (1, 2)),
            ADD CONSTRAINT exams_closure_valid CHECK (closure IN ('done', 'moed_b')),
            ADD CONSTRAINT exams_closure_closed_at_together
                CHECK ((closure IS NULL) = (closed_at IS NULL)),
            ADD CONSTRAINT exams_moed_b_only_from_first_sitting
                CHECK (sitting = 1 OR closure IS DISTINCT FROM 'moed_b'),
            ADD CONSTRAINT exams_first_exam_date_at_second_sitting
                CHECK ((sitting = 2) = (first_exam_date IS NOT NULL)),
            ADD CONSTRAINT exams_first_grade_range CHECK (first_grade BETWEEN 0 AND 100),
            ADD CONSTRAINT exams_moed_b_notes_length
                CHECK (btrim(moed_b_notes) <> '' AND char_length(moed_b_notes) <= 1000),
            ADD CONSTRAINT exams_moed_b_topic_ids_shape CHECK (
                array_ndims(moed_b_topic_ids) IS NULL
                OR (
                    array_ndims(moed_b_topic_ids) = 1
                    AND cardinality(moed_b_topic_ids) <= 50
                    AND array_position(moed_b_topic_ids, NULL) IS NULL
                )
            ),
            ADD CONSTRAINT exams_moed_b_fields_at_second_sitting CHECK (
                sitting = 2
                OR (
                    first_grade IS NULL
                    AND moed_b_notes IS NULL
                    AND cardinality(moed_b_topic_ids) = 0
                )
            )
    """)
    op.execute("""
        CREATE INDEX exams_closure_due_idx ON app.exams (exam_date)
        WHERE closure IS NULL AND closure_notified_at IS NULL AND deleted_at IS NULL
    """)

    op.execute("""
        ALTER TABLE app.tasks
            ADD COLUMN sitting smallint NOT NULL DEFAULT 1,
            ADD CONSTRAINT tasks_sitting_valid CHECK (sitting IN (1, 2))
    """)
    op.execute("""
        CREATE FUNCTION app.tasks_set_sitting() RETURNS trigger
        LANGUAGE plpgsql
        SECURITY INVOKER
        SET search_path = ''
        AS $$
        BEGIN
            NEW.sitting := COALESCE(
                (SELECT sitting FROM app.exams
                 WHERE id = NEW.exam_id AND user_id = NEW.user_id),
                1
            );
            RETURN NEW;
        END
        $$
    """)
    op.execute("""
        CREATE TRIGGER tasks_set_sitting
            BEFORE INSERT ON app.tasks
            FOR EACH ROW EXECUTE FUNCTION app.tasks_set_sitting()
    """)

    op.execute("""
        ALTER TABLE app.plan_versions
            ADD COLUMN exam_before jsonb,
            ADD CONSTRAINT plan_versions_exam_before_shape
                CHECK (jsonb_typeof(exam_before) = 'object')
    """)
    op.execute("REVOKE INSERT ON app.plan_versions FROM authenticated")
    op.execute(
        f"GRANT INSERT ({_PLAN_VERSIONS_INSERT_0014}, exam_before) "
        "ON app.plan_versions TO authenticated"
    )


def downgrade() -> None:
    op.execute("REVOKE INSERT ON app.plan_versions FROM authenticated")
    op.execute(f"GRANT INSERT ({_PLAN_VERSIONS_INSERT_0014}) ON app.plan_versions TO authenticated")
    op.execute("""
        ALTER TABLE app.plan_versions
            DROP CONSTRAINT plan_versions_exam_before_shape,
            DROP COLUMN exam_before
    """)

    op.execute("DROP TRIGGER tasks_set_sitting ON app.tasks")
    op.execute("DROP FUNCTION app.tasks_set_sitting()")
    op.execute("""
        ALTER TABLE app.tasks
            DROP CONSTRAINT tasks_sitting_valid,
            DROP COLUMN sitting
    """)

    op.execute("DROP INDEX app.exams_closure_due_idx")
    op.execute("""
        ALTER TABLE app.exams
            DROP CONSTRAINT exams_moed_b_fields_at_second_sitting,
            DROP CONSTRAINT exams_moed_b_topic_ids_shape,
            DROP CONSTRAINT exams_moed_b_notes_length,
            DROP CONSTRAINT exams_first_grade_range,
            DROP CONSTRAINT exams_first_exam_date_at_second_sitting,
            DROP CONSTRAINT exams_moed_b_only_from_first_sitting,
            DROP CONSTRAINT exams_closure_closed_at_together,
            DROP CONSTRAINT exams_closure_valid,
            DROP CONSTRAINT exams_sitting_valid,
            DROP COLUMN moed_b_topic_ids,
            DROP COLUMN moed_b_notes,
            DROP COLUMN first_grade,
            DROP COLUMN first_exam_date,
            DROP COLUMN closure_notified_at,
            DROP COLUMN closed_at,
            DROP COLUMN closure,
            DROP COLUMN sitting
    """)
