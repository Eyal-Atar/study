"""Harden plan_versions writes, require whole-minute blocks, link versions to exam and task

Explicit SQL, written by hand.

`authenticated` may no longer set `created_at` or `undone_at` on INSERT: the server clock
decides both. A BEFORE UPDATE OF undone_at trigger makes `undone_at` write-once and forces
it to now(), so a client cannot back-date an undo or undo twice. It is OF undone_at because
the SET NULL of a deleted exam or task updates the row too and must pass. `exam_id` and
`task_id` record which exam or task a version was taken for (the undo of a delete needs
them); the composite foreign keys keep them inside the owner's own rows, and a hard delete
of the exam or task only nulls that column, the version stays.

Block times are stored as whole minutes: the planner works in minutes, and a block at
10:00:30 would silently drift from its snapshot.
"""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE app.blocks
            ADD CONSTRAINT blocks_whole_minutes CHECK (
                date_trunc('minute', starts_at) = starts_at
                AND date_trunc('minute', ends_at) = ends_at
            )
    """)

    op.execute("""
        ALTER TABLE app.plan_versions
            ADD COLUMN exam_id uuid,
            ADD COLUMN task_id uuid,
            ADD CONSTRAINT plan_versions_exam_fkey FOREIGN KEY (exam_id, user_id)
                REFERENCES app.exams (id, user_id) ON DELETE SET NULL (exam_id),
            ADD CONSTRAINT plan_versions_task_fkey FOREIGN KEY (task_id, user_id)
                REFERENCES app.tasks (id, user_id) ON DELETE SET NULL (task_id)
    """)

    op.execute("REVOKE INSERT ON app.plan_versions FROM authenticated")
    op.execute("""
        GRANT INSERT (user_id, reason, snapshot, exam_id, task_id)
        ON app.plan_versions TO authenticated
    """)

    op.execute("""
        CREATE FUNCTION app.plan_versions_undo_once() RETURNS trigger
        LANGUAGE plpgsql
        SET search_path = ''
        AS $$
        BEGIN
            IF OLD.undone_at IS NOT NULL OR NEW.undone_at IS NULL THEN
                RAISE EXCEPTION 'a plan version can be undone exactly once'
                    USING ERRCODE = 'check_violation';
            END IF;
            NEW.undone_at := pg_catalog.now();
            RETURN NEW;
        END
        $$
    """)
    op.execute("""
        CREATE TRIGGER plan_versions_undo_once
        BEFORE UPDATE OF undone_at ON app.plan_versions
        FOR EACH ROW EXECUTE FUNCTION app.plan_versions_undo_once()
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER plan_versions_undo_once ON app.plan_versions")
    op.execute("DROP FUNCTION app.plan_versions_undo_once()")
    op.execute("""
        REVOKE INSERT (user_id, reason, snapshot, exam_id, task_id)
        ON app.plan_versions FROM authenticated
    """)
    op.execute("""
        ALTER TABLE app.plan_versions
            DROP CONSTRAINT plan_versions_exam_fkey,
            DROP CONSTRAINT plan_versions_task_fkey,
            DROP COLUMN exam_id,
            DROP COLUMN task_id
    """)
    op.execute("GRANT INSERT ON app.plan_versions TO authenticated")
    op.execute("ALTER TABLE app.blocks DROP CONSTRAINT blocks_whole_minutes")
