"""Add the XP ledger (xp_events) and the earned badges (badges)

Explicit SQL, written by hand.

`xp_events` holds one row per completed block: the XP it earned and the study day it counts
for. `study_date` is stored, not recomputed, so a later change of time zone or sleep time
does not rewrite the days already counted (the streak stays stable). `block_id` is unique, so
a block earns XP at most once; `uncomplete` deletes the row. The composite key
`(block_id, user_id)` keeps a row from pointing at another user's block, and
`ON DELETE SET NULL (block_id)` (naming only that column, because `user_id` is NOT NULL) keeps
the XP if the block is ever hard-deleted. That key needs `UNIQUE (id, user_id)` on `blocks`,
added here.

`badges` holds the badges a user has earned, one row per key. Badges are derived from the
ledger, so the API inserts and deletes them; `earned_at` is set by the database.

`user_id` in both tables references `profiles (id)`, not `auth.users`, with ON DELETE CASCADE:
`app.delete_account_data()` (0009) deletes the profile, and the cascade removes these rows
without redefining that function (S16 redefines it in 0010, and two migrations replacing it
would overwrite each other). The profile itself cascades from `auth.users`.

`authenticated` gets SELECT, DELETE, and INSERT only on the columns the API writes. There is
no UPDATE: a row is written once, and `id`, `created_at` and `earned_at` are the database's.
"""

from alembic import op

revision = "0011"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE app.blocks ADD CONSTRAINT blocks_id_user_id_key UNIQUE (id, user_id)")

    op.execute("""
        CREATE TABLE app.xp_events (
            id uuid NOT NULL DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL,
            block_id uuid,
            xp integer NOT NULL,
            study_date date NOT NULL,
            created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            CONSTRAINT xp_events_pkey PRIMARY KEY (id),
            CONSTRAINT xp_events_user_id_fkey FOREIGN KEY (user_id)
                REFERENCES app.profiles (id) ON DELETE CASCADE,
            CONSTRAINT xp_events_block_fkey FOREIGN KEY (block_id, user_id)
                REFERENCES app.blocks (id, user_id) ON DELETE SET NULL (block_id),
            CONSTRAINT xp_events_block_id_key UNIQUE (block_id),
            CONSTRAINT xp_events_xp_range CHECK (xp BETWEEN 0 AND 100000)
        )
    """)
    op.execute("CREATE INDEX xp_events_user_study_date_idx ON app.xp_events (user_id, study_date)")
    op.execute("ALTER TABLE app.xp_events ENABLE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY xp_events_owner ON app.xp_events FOR ALL TO authenticated
        USING (user_id = (SELECT auth.uid()))
        WITH CHECK (user_id = (SELECT auth.uid()))
    """)
    op.execute("GRANT SELECT, DELETE ON app.xp_events TO authenticated")
    op.execute("GRANT INSERT (user_id, block_id, xp, study_date) ON app.xp_events TO authenticated")

    op.execute("""
        CREATE TABLE app.badges (
            user_id uuid NOT NULL,
            badge_key text NOT NULL,
            earned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            CONSTRAINT badges_pkey PRIMARY KEY (user_id, badge_key),
            CONSTRAINT badges_user_id_fkey FOREIGN KEY (user_id)
                REFERENCES app.profiles (id) ON DELETE CASCADE,
            CONSTRAINT badges_key_format CHECK (badge_key ~ '^[a-z][a-z0-9_]{0,39}$')
        )
    """)
    op.execute("ALTER TABLE app.badges ENABLE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY badges_owner ON app.badges FOR ALL TO authenticated
        USING (user_id = (SELECT auth.uid()))
        WITH CHECK (user_id = (SELECT auth.uid()))
    """)
    op.execute("GRANT SELECT, DELETE ON app.badges TO authenticated")
    op.execute("GRANT INSERT (user_id, badge_key) ON app.badges TO authenticated")


def downgrade() -> None:
    op.execute("DROP TABLE app.badges")
    op.execute("DROP TABLE app.xp_events")
    op.execute("ALTER TABLE app.blocks DROP CONSTRAINT blocks_id_user_id_key")
