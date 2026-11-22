"""The first plan's XP: app.xp_events gets a kind (S34)

Explicit SQL, written by hand.

Until now app.xp_events (0011) held one row per completed block, and the service counted
every row as a block (`blocks_done`, the streak, the 14 days). S34 decision 8 gives a
student 50 real XP for the first plan after the onboarding, once, so the ledger needs a
second kind of row that adds XP without being a block or a study day:

- `kind text NOT NULL DEFAULT 'block'`: a constant default fills every existing row
  without an UPDATE (a metadata-only change in Postgres); they all are blocks.
- `xp_events_kind_check`: a closed list, so a new kind comes through a migration and does
  not appear silently.
- `xp_events_kind_block`: a `first_plan` row never points at a block. The other way is not
  enforced: a deleted block leaves its row with `block_id = NULL` and kind 'block'.
- `xp_events_first_plan_key`: the partial unique index is the database's guard of "once
  per user", under a retry and under two jobs at once.
- `GRANT INSERT (kind)`: the worker writes as `authenticated` (RLS), and 0011 grants
  INSERT per column. No policy changes.

No backfill: a user who finished the onboarding before 0018 gets no XP for it.

The downgrade deletes the `first_plan` rows first: without the column they would be
counted as blocks.
"""

from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE app.xp_events ADD COLUMN kind text NOT NULL DEFAULT 'block'")
    op.execute(
        "ALTER TABLE app.xp_events ADD CONSTRAINT xp_events_kind_check "
        "CHECK (kind IN ('block', 'first_plan'))"
    )
    op.execute(
        "ALTER TABLE app.xp_events ADD CONSTRAINT xp_events_kind_block "
        "CHECK (kind = 'block' OR block_id IS NULL)"
    )
    op.execute(
        "CREATE UNIQUE INDEX xp_events_first_plan_key ON app.xp_events (user_id) "
        "WHERE kind = 'first_plan'"
    )
    op.execute("GRANT INSERT (kind) ON app.xp_events TO authenticated")


def downgrade() -> None:
    op.execute("DELETE FROM app.xp_events WHERE kind <> 'block'")
    op.execute("REVOKE INSERT (kind) ON app.xp_events FROM authenticated")
    op.execute("DROP INDEX app.xp_events_first_plan_key")
    op.execute("ALTER TABLE app.xp_events DROP CONSTRAINT xp_events_kind_block")
    op.execute("ALTER TABLE app.xp_events DROP CONSTRAINT xp_events_kind_check")
    op.execute("ALTER TABLE app.xp_events DROP COLUMN kind")
