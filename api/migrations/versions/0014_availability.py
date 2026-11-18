"""Add weekly commitments and one-off busy events, and move the hobby into commitments

Explicit SQL, written by hand.

`commitments` holds the weekly times a user is not free: work, classes, anything else.
`weekday` is 0-6 with 0 = Sunday, like Postgres `extract(dow)` and JavaScript `getDay()`.
`start_time` and `end_time` are local wall-clock times in whole minutes; `end_time <
start_time` means the occurrence crosses midnight, so the two may not be equal, and the
wall-clock duration ((end - start) mod 24 hours) must be at least 15 minutes. `valid_from`
and `valid_until` (inclusive, or NULL for open-ended) apply to the local date on which an
occurrence starts. `source_job_id` records the timetable-parsing job a commitment was
approved from; the composite key keeps it inside the owner's own jobs, and
`ON DELETE SET NULL (source_job_id)` (naming only that column, because `user_id` is NOT NULL)
keeps the commitment when the job is deleted.

`busy_events` holds one-off busy times in UTC, in whole minutes like blocks, at most 14 days
long. The title is optional.

Both tables are soft-deleted: `authenticated` may set `deleted_at` but has no DELETE.
Account deletion goes through `app.delete_account_data()`, redefined here to delete both
tables (after `plan_versions`, which references `busy_events`); the `user_id` foreign key to
`auth.users` cascades as well, like the other tables. INSERT and UPDATE are granted on
columns only, so `id`, `user_id` (after insert), `source_job_id` (after insert) and
`created_at` belong to the database.

`plan_versions` gains `busy_event_id`, the event a `busy_added` or `busy_changed` version was
taken for (undo deletes the event or restores its time), and `busy_event_before`, the event's
editable fields before a `busy_changed`. The key is composite, like every key between the
app's tables, so a version never points at another user's event. The INSERT column grant on
`plan_versions` was last set in 0012; it is re-issued here with both columns added and
restored in downgrade.

The S15 hobby (`profiles.hobby_start`, `hobby_minutes`) becomes seven commitments, one per
weekday, titled 'זמן לעצמי' with kind 'other' and no end date, valid from the local date the
profile was created; the two columns are then cleared. They stay (a dropped column cannot be
brought back by a downgrade) until S34 removes them together with the API's compatibility
layer. The downgrade puts a hobby back for every user whose live commitments still hold a
complete "hobby set" (seven rows with that title, kind 'other', no end date and the same
times, one per weekday) whose duration fits the old 15-240 minute CHECK; every other
commitment and every event is lost.
"""

from alembic import op

revision = "0014"
down_revision = "0012"
branch_labels = None
depends_on = None

# app.delete_account_data() as 0010 defined it, with a slot for the availability tables.
# The downgrade fills the slot with nothing and so restores 0010's body exactly.
_DELETE_ACCOUNT_DATA = """
    CREATE OR REPLACE FUNCTION app.delete_account_data() RETURNS void
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
        DELETE FROM app.push_subscriptions WHERE user_id = uid;
        DELETE FROM app.blocks WHERE user_id = uid;
        DELETE FROM app.plan_versions WHERE user_id = uid;
        {availability}DELETE FROM app.tasks WHERE user_id = uid;
        DELETE FROM app.topics WHERE user_id = uid;
        DELETE FROM app.analyses WHERE user_id = uid;
        DELETE FROM app.ai_usage WHERE user_id = uid;
        DELETE FROM app.materials WHERE user_id = uid;
        DELETE FROM app.jobs WHERE user_id = uid;
        DELETE FROM app.exams WHERE user_id = uid;
        DELETE FROM app.profiles WHERE id = uid;
    END
    $$
"""
# busy_events after plan_versions (which references them), commitments before jobs (which
# they reference). Both keys are SET NULL, so the order is for clarity, not correctness.
_AVAILABILITY_DELETE = (
    "DELETE FROM app.busy_events WHERE user_id = uid;\n"
    "        DELETE FROM app.commitments WHERE user_id = uid;\n"
    "        "
)


def upgrade() -> None:
    op.execute("""
        CREATE TABLE app.commitments (
            id uuid NOT NULL DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL,
            title text NOT NULL,
            kind text NOT NULL,
            weekday smallint NOT NULL,
            start_time time NOT NULL,
            end_time time NOT NULL,
            valid_from date NOT NULL,
            valid_until date,
            source_job_id uuid,
            created_at timestamptz NOT NULL DEFAULT now(),
            deleted_at timestamptz,
            CONSTRAINT commitments_pkey PRIMARY KEY (id),
            CONSTRAINT commitments_user_id_fkey FOREIGN KEY (user_id)
                REFERENCES auth.users (id) ON DELETE CASCADE,
            CONSTRAINT commitments_id_user_id_key UNIQUE (id, user_id),
            CONSTRAINT commitments_source_job_fkey FOREIGN KEY (source_job_id, user_id)
                REFERENCES app.jobs (id, user_id) ON DELETE SET NULL (source_job_id),
            CONSTRAINT commitments_title_length
                CHECK (btrim(title) <> '' AND char_length(title) <= 100),
            CONSTRAINT commitments_kind_valid CHECK (kind IN ('work', 'class', 'other')),
            CONSTRAINT commitments_weekday_range CHECK (weekday BETWEEN 0 AND 6),
            CONSTRAINT commitments_whole_minutes CHECK (
                extract(second FROM start_time) = 0 AND extract(second FROM end_time) = 0
            ),
            CONSTRAINT commitments_start_differs_from_end CHECK (start_time <> end_time),
            CONSTRAINT commitments_min_duration CHECK (
                CASE WHEN end_time > start_time THEN end_time - start_time
                     ELSE end_time - start_time + interval '24 hours'
                END >= interval '15 minutes'
            ),
            CONSTRAINT commitments_valid_range
                CHECK (valid_until IS NULL OR valid_until >= valid_from)
        )
    """)
    op.execute(
        "CREATE INDEX commitments_user_live_idx ON app.commitments (user_id) "
        "WHERE deleted_at IS NULL"
    )
    op.execute(
        "CREATE INDEX commitments_source_job_idx ON app.commitments (source_job_id) "
        "WHERE source_job_id IS NOT NULL"
    )
    op.execute("ALTER TABLE app.commitments ENABLE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY commitments_owner ON app.commitments FOR ALL TO authenticated
        USING (user_id = (SELECT auth.uid()))
        WITH CHECK (user_id = (SELECT auth.uid()))
    """)
    op.execute("GRANT SELECT ON app.commitments TO authenticated")
    op.execute("""
        GRANT INSERT (user_id, title, kind, weekday, start_time, end_time, valid_from,
                      valid_until, source_job_id)
        ON app.commitments TO authenticated
    """)
    op.execute("""
        GRANT UPDATE (title, kind, weekday, start_time, end_time, valid_from, valid_until,
                      deleted_at)
        ON app.commitments TO authenticated
    """)

    op.execute("""
        CREATE TABLE app.busy_events (
            id uuid NOT NULL DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL,
            title text,
            starts_at timestamptz NOT NULL,
            ends_at timestamptz NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            deleted_at timestamptz,
            CONSTRAINT busy_events_pkey PRIMARY KEY (id),
            CONSTRAINT busy_events_user_id_fkey FOREIGN KEY (user_id)
                REFERENCES auth.users (id) ON DELETE CASCADE,
            CONSTRAINT busy_events_id_user_id_key UNIQUE (id, user_id),
            CONSTRAINT busy_events_title_length
                CHECK (btrim(title) <> '' AND char_length(title) <= 100),
            CONSTRAINT busy_events_whole_minutes CHECK (
                date_trunc('minute', starts_at) = starts_at
                AND date_trunc('minute', ends_at) = ends_at
            ),
            CONSTRAINT busy_events_ends_after_starts CHECK (ends_at > starts_at),
            CONSTRAINT busy_events_max_duration
                CHECK (ends_at - starts_at <= interval '14 days')
        )
    """)
    op.execute(
        "CREATE INDEX busy_events_user_ends_at_idx ON app.busy_events (user_id, ends_at) "
        "WHERE deleted_at IS NULL"
    )
    op.execute("ALTER TABLE app.busy_events ENABLE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY busy_events_owner ON app.busy_events FOR ALL TO authenticated
        USING (user_id = (SELECT auth.uid()))
        WITH CHECK (user_id = (SELECT auth.uid()))
    """)
    op.execute("GRANT SELECT ON app.busy_events TO authenticated")
    op.execute(
        "GRANT INSERT (user_id, title, starts_at, ends_at) ON app.busy_events TO authenticated"
    )
    op.execute(
        "GRANT UPDATE (title, starts_at, ends_at, deleted_at) ON app.busy_events TO authenticated"
    )

    op.execute("""
        ALTER TABLE app.plan_versions
            ADD COLUMN busy_event_id uuid,
            ADD COLUMN busy_event_before jsonb,
            ADD CONSTRAINT plan_versions_busy_event_fkey FOREIGN KEY (busy_event_id, user_id)
                REFERENCES app.busy_events (id, user_id) ON DELETE SET NULL (busy_event_id),
            ADD CONSTRAINT plan_versions_busy_event_before_shape
                CHECK (jsonb_typeof(busy_event_before) = 'object')
    """)
    op.execute(
        "CREATE INDEX plan_versions_busy_event_idx ON app.plan_versions (busy_event_id) "
        "WHERE busy_event_id IS NOT NULL"
    )
    op.execute("REVOKE INSERT ON app.plan_versions FROM authenticated")
    op.execute("""
        GRANT INSERT (user_id, reason, snapshot, exam_id, task_id, task_before, analysis_id,
                      block_id, busy_event_id, busy_event_before)
        ON app.plan_versions TO authenticated
    """)

    # CREATE OR REPLACE keeps the owner, the REVOKE from PUBLIC and the GRANT of 0009.
    op.execute(_DELETE_ACCOUNT_DATA.replace("{availability}", _AVAILABILITY_DELETE))

    # The hobby becomes seven commitments. A time zone Postgres does not know (the column is
    # free text) falls back to UTC for the start date rather than failing the migration.
    op.execute("""
        INSERT INTO app.commitments (user_id, title, kind, weekday, start_time, end_time,
                                     valid_from)
        SELECT p.id, 'זמן לעצמי', 'other', d.weekday, p.hobby_start,
               p.hobby_start + make_interval(mins => p.hobby_minutes),
               (p.created_at AT TIME ZONE CASE
                   WHEN EXISTS (SELECT FROM pg_timezone_names t WHERE t.name = p.timezone)
                   THEN p.timezone ELSE 'UTC' END)::date
        FROM app.profiles p
        CROSS JOIN generate_series(0, 6) AS d (weekday)
        WHERE p.hobby_start IS NOT NULL
        ORDER BY p.id, d.weekday
    """)
    op.execute("""
        UPDATE app.profiles SET hobby_start = NULL, hobby_minutes = NULL
        WHERE hobby_start IS NOT NULL
    """)


def downgrade() -> None:
    # A complete hobby set back into the profile, when its duration fits the old CHECK. A user
    # with more than one complete set (the API never writes that) gets the earliest-created.
    op.execute("""
        WITH sets AS (
            SELECT user_id, start_time, end_time, min(created_at) AS created_at,
                   extract(epoch FROM CASE WHEN end_time > start_time
                                           THEN end_time - start_time
                                           ELSE end_time - start_time + interval '24 hours'
                                      END)::integer / 60 AS minutes
            FROM app.commitments
            WHERE deleted_at IS NULL AND kind = 'other' AND title = 'זמן לעצמי'
                AND valid_until IS NULL
            GROUP BY user_id, start_time, end_time
            HAVING count(*) = 7 AND count(DISTINCT weekday) = 7
        ),
        chosen AS (
            SELECT DISTINCT ON (user_id) user_id, start_time, minutes
            FROM sets
            WHERE minutes BETWEEN 15 AND 240
            ORDER BY user_id, created_at, start_time
        )
        UPDATE app.profiles p
        SET hobby_start = c.start_time, hobby_minutes = c.minutes
        FROM chosen c
        WHERE p.id = c.user_id
    """)

    op.execute(_DELETE_ACCOUNT_DATA.replace("{availability}", ""))

    op.execute("REVOKE INSERT ON app.plan_versions FROM authenticated")
    op.execute("""
        GRANT INSERT (user_id, reason, snapshot, exam_id, task_id, task_before, analysis_id,
                      block_id)
        ON app.plan_versions TO authenticated
    """)
    op.execute("DROP INDEX app.plan_versions_busy_event_idx")
    op.execute("""
        ALTER TABLE app.plan_versions
            DROP CONSTRAINT plan_versions_busy_event_before_shape,
            DROP CONSTRAINT plan_versions_busy_event_fkey,
            DROP COLUMN busy_event_before,
            DROP COLUMN busy_event_id
    """)
    op.execute("DROP TABLE app.busy_events")
    op.execute("DROP TABLE app.commitments")
