"""Create plan_versions and forbid overlapping live blocks

Explicit SQL, written by hand. A plan version is a snapshot of the future blocks taken
before a plan change, so the change can be undone. `blocks.plan_version_id` is the version
that last wrote the block. `authenticated` gets no DELETE on plan_versions: a version that
was undone is marked with `undone_at`, never removed.

The snapshot shape check ends in IS TRUE because a missing key makes jsonb_typeof NULL,
and a CHECK accepts NULL (so '{}' would otherwise pass).

The exclusion constraint forbids two PLANNED or DONE blocks of one user from overlapping.
It is deferrable, so a transaction may pass through an overlapping state (two blocks
swapping places) and the check runs at COMMIT. btree_gist is needed for `user_id WITH =`.
"""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions")

    op.execute("""
        CREATE TABLE app.plan_versions (
            id uuid NOT NULL DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL,
            reason text NOT NULL,
            snapshot jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            undone_at timestamptz,
            CONSTRAINT plan_versions_pkey PRIMARY KEY (id),
            CONSTRAINT plan_versions_user_id_fkey FOREIGN KEY (user_id)
                REFERENCES auth.users (id) ON DELETE CASCADE,
            CONSTRAINT plan_versions_reason_format CHECK (reason ~ '^[a-z][a-z_]{0,39}$'),
            CONSTRAINT plan_versions_snapshot_shape CHECK ((
                jsonb_typeof(snapshot) = 'object'
                AND jsonb_typeof(snapshot -> 'v') = 'number'
                AND jsonb_typeof(snapshot -> 'blocks') = 'array'
            ) IS TRUE),
            CONSTRAINT plan_versions_snapshot_size CHECK (pg_column_size(snapshot) <= 1048576),
            CONSTRAINT plan_versions_id_user_id_key UNIQUE (id, user_id)
        )
    """)
    op.execute("""
        CREATE INDEX plan_versions_user_created_at_idx
        ON app.plan_versions (user_id, created_at DESC)
    """)
    op.execute("ALTER TABLE app.plan_versions ENABLE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY plan_versions_owner ON app.plan_versions FOR ALL TO authenticated
        USING (user_id = (SELECT auth.uid()))
        WITH CHECK (user_id = (SELECT auth.uid()))
    """)
    op.execute("GRANT SELECT, INSERT ON app.plan_versions TO authenticated")
    op.execute("GRANT UPDATE (undone_at) ON app.plan_versions TO authenticated")

    op.execute("""
        ALTER TABLE app.blocks
            ADD COLUMN plan_version_id uuid,
            ADD CONSTRAINT blocks_plan_version_fkey FOREIGN KEY (plan_version_id, user_id)
                REFERENCES app.plan_versions (id, user_id) ON DELETE SET NULL (plan_version_id),
            ADD CONSTRAINT blocks_no_overlap EXCLUDE USING gist (
                user_id WITH =, tstzrange(starts_at, ends_at) WITH &&
            ) WHERE (status IN ('planned', 'done')) DEFERRABLE INITIALLY DEFERRED
    """)
    op.execute("""
        CREATE INDEX blocks_plan_version_idx ON app.blocks (plan_version_id)
        WHERE plan_version_id IS NOT NULL
    """)


def downgrade() -> None:
    # The extension stays: it may be shared with other objects and costs nothing.
    op.execute("DROP INDEX app.blocks_plan_version_idx")
    op.execute("""
        ALTER TABLE app.blocks
            DROP CONSTRAINT blocks_no_overlap,
            DROP CONSTRAINT blocks_plan_version_fkey,
            DROP COLUMN plan_version_id
    """)
    op.execute("DROP TABLE app.plan_versions")
