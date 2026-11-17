"""Link a plan version to the past block a morning review marked

Explicit SQL, written by hand.

The morning review (S18) marks a block that ended without a mark `missed` ("move it")
or `skipped` ("skip the task"). Undo brings the future blocks back from the snapshot, but
the reviewed block is in the past and no snapshot holds it, so the version keeps its id
in `plan_versions.block_id`, and undo sets that block back to `planned`.

The foreign key is composite, `(block_id, user_id)`, like every key between the app's
tables, so a version can never point at another user's block; the `UNIQUE (id, user_id)`
it needs on `blocks` comes from 0011 (S19). `ON DELETE SET NULL (block_id)` names only the
referencing column, because a plain SET NULL would also null `user_id`, which is NOT NULL.

The INSERT column grant on `plan_versions` was last set in 0008; it is re-issued here with
`block_id` added (a column grant cannot be extended in place) and restored in downgrade.
"""

from alembic import op

revision = "0012"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE app.plan_versions
            ADD COLUMN block_id uuid,
            ADD CONSTRAINT plan_versions_block_fkey FOREIGN KEY (block_id, user_id)
                REFERENCES app.blocks (id, user_id) ON DELETE SET NULL (block_id)
    """)
    op.execute(
        "CREATE INDEX plan_versions_block_idx ON app.plan_versions (block_id) "
        "WHERE block_id IS NOT NULL"
    )
    op.execute("REVOKE INSERT ON app.plan_versions FROM authenticated")
    op.execute("""
        GRANT INSERT (user_id, reason, snapshot, exam_id, task_id, task_before, analysis_id,
                      block_id)
        ON app.plan_versions TO authenticated
    """)


def downgrade() -> None:
    op.execute("REVOKE INSERT ON app.plan_versions FROM authenticated")
    op.execute("""
        GRANT INSERT (user_id, reason, snapshot, exam_id, task_id, task_before, analysis_id)
        ON app.plan_versions TO authenticated
    """)
    op.execute("DROP INDEX app.plan_versions_block_idx")
    op.execute("""
        ALTER TABLE app.plan_versions
            DROP CONSTRAINT plan_versions_block_fkey,
            DROP COLUMN block_id
    """)
