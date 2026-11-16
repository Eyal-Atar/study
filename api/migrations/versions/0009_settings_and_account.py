"""Add the settings-screen preferences, let the user change a material's kind, and delete an account

Explicit SQL, written by hand.

`profiles` gains three preferences the settings screen shows (S15):
- `study_start_delay_minutes`: how long after waking studying may start (0-360, default 60,
  the planner's former built-in hour).
- `hobby_start` and `hobby_minutes`: a daily block of time for oneself that the planner keeps
  free. Both NULL means off (the default, spec 11.13); both are set together, or neither.

`authenticated` may now UPDATE `materials.kind` (and still only the result columns besides):
a material uploaded with the wrong kind can be fixed on the exam screen.

`app.delete_account_data()` deletes every row the calling user owns in the `app` schema, at
once, for `DELETE /me`. It runs as its owner (SECURITY DEFINER), because `authenticated` has
no DELETE on `profiles`, `plan_versions`, `analyses`, `ai_usage` or `jobs`, on purpose. It
takes no argument: it deletes only `auth.uid()`, and fails when there is none. The files in
Storage and the user in Auth are deleted afterwards by the worker (job `delete_account`); the
`ON DELETE CASCADE` from `auth.users` then removes anything written in between.
"""

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE app.profiles
            ADD COLUMN study_start_delay_minutes smallint NOT NULL DEFAULT 60,
            ADD COLUMN hobby_start time,
            ADD COLUMN hobby_minutes smallint,
            ADD CONSTRAINT profiles_study_start_delay_range
                CHECK (study_start_delay_minutes BETWEEN 0 AND 360),
            ADD CONSTRAINT profiles_hobby_together
                CHECK ((hobby_start IS NULL) = (hobby_minutes IS NULL)),
            ADD CONSTRAINT profiles_hobby_minutes_range CHECK (hobby_minutes BETWEEN 15 AND 240),
            ADD CONSTRAINT profiles_hobby_start_whole_minute
                CHECK (extract(second FROM hobby_start) = 0)
    """)
    op.execute("GRANT UPDATE (kind) ON app.materials TO authenticated")
    op.execute("""
        CREATE FUNCTION app.delete_account_data() RETURNS void
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = ''
        AS $$
        DECLARE
            uid uuid := auth.uid();
        BEGIN
            IF uid IS NULL THEN
                RAISE EXCEPTION 'delete_account_data needs a signed-in user'
                    USING ERRCODE = 'insufficient_privilege';
            END IF;
            DELETE FROM app.blocks WHERE user_id = uid;
            DELETE FROM app.plan_versions WHERE user_id = uid;
            DELETE FROM app.tasks WHERE user_id = uid;
            DELETE FROM app.topics WHERE user_id = uid;
            DELETE FROM app.analyses WHERE user_id = uid;
            DELETE FROM app.ai_usage WHERE user_id = uid;
            DELETE FROM app.materials WHERE user_id = uid;
            DELETE FROM app.jobs WHERE user_id = uid;
            DELETE FROM app.exams WHERE user_id = uid;
            DELETE FROM app.profiles WHERE id = uid;
        END
        $$
    """)
    op.execute("REVOKE ALL ON FUNCTION app.delete_account_data() FROM PUBLIC")
    op.execute("GRANT EXECUTE ON FUNCTION app.delete_account_data() TO authenticated")


def downgrade() -> None:
    op.execute("DROP FUNCTION app.delete_account_data()")
    op.execute("REVOKE UPDATE (kind) ON app.materials FROM authenticated")
    op.execute("""
        ALTER TABLE app.profiles
            DROP CONSTRAINT profiles_hobby_start_whole_minute,
            DROP CONSTRAINT profiles_hobby_minutes_range,
            DROP CONSTRAINT profiles_hobby_together,
            DROP CONSTRAINT profiles_study_start_delay_range,
            DROP COLUMN hobby_minutes,
            DROP COLUMN hobby_start,
            DROP COLUMN study_start_delay_minutes
    """)
