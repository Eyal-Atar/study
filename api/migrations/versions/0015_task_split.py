"""Split a task into bites (S44): tasks.bite_minutes and tasks.split_dismissed_at

Explicit SQL, written by hand.

1. `bite_minutes smallint NULL CHECK (30-300)`: the length of one bite of a task the user
   split after putting it off three times (S44, audit section 15). NULL is a task the
   planner packs as before. The planner treats a task with bites as a multi-day task that
   gets one bite a day; 30 is the planner's shortest part (MIN_PART_MINUTES).
2. `split_dismissed_at timestamptz NULL`: when the user answered the split offer with
   "Not now". Only deferrals after it count toward the next offer. It is written with the
   database clock (`clock_timestamp()`), like `plan_versions.created_at` and
   `xp_events.created_at`, which the count compares it with.
3. `plan_versions_user_task_idx`: the deferral count reads a user's versions of one task
   (task_id, reason, created_at); the existing index is on (user_id, created_at) only.

Both columns are on a table that already has RLS and full grants for `authenticated`.
"""

from alembic import op

revision = "0015"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE app.tasks
            ADD COLUMN bite_minutes smallint,
            ADD COLUMN split_dismissed_at timestamptz,
            ADD CONSTRAINT tasks_bite_minutes_range CHECK (bite_minutes BETWEEN 30 AND 300)
    """)
    op.execute("""
        CREATE INDEX plan_versions_user_task_idx
            ON app.plan_versions (user_id, task_id, created_at)
            WHERE task_id IS NOT NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX app.plan_versions_user_task_idx")
    op.execute("""
        ALTER TABLE app.tasks
            DROP CONSTRAINT tasks_bite_minutes_range,
            DROP COLUMN split_dismissed_at,
            DROP COLUMN bite_minutes
    """)
