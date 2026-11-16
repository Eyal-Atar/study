"""Add push_subscriptions, blocks.notified_at and the four reminder lead times

Explicit SQL, written by hand.

`push_subscriptions` holds one Web Push subscription per browser. The endpoint is unique
across the whole table: a shared device gives the same endpoint to whoever signs in next, and
the previous user's reminders (with their task names) must stop reaching it. Before saving a
subscription the API calls `app.take_push_endpoint`, which deletes another user's row with the
same endpoint. RLS cannot allow that delete, so the function is SECURITY DEFINER; it runs as
its owner, the migration role, which also owns the table and therefore bypasses RLS (the table
does not FORCE row level security). It only ever deletes rows whose endpoint the caller
presents, and the endpoint is a secret URL only that browser knows. `authenticated` gets
column grants only: the client sets the endpoint and keys, and may reset `failure_count` when
it registers again; `last_success_at` and the rest belong to the worker, which runs as the
schema owner.

`blocks.notified_at` is set by the worker when it sends a block's reminder, and the partial
index `blocks_due_reminder_idx` keeps its scan over planned, not yet notified blocks small.
Moving a block (a new `starts_at`) clears `notified_at`, so the block is reminded again at its
new time; the trigger fires only when the value actually changes.

`profiles.notify_lead_minutes` becomes one of 0, 5, 10 or 15, with 0 (the start of the block)
as the default. The old default 10 was never chosen by anyone, since there was no UI for it,
so rows with 10 move to 0; values outside the four choices also move to 0, so the new CHECK
can be added. The downgrade restores the 0-120 range and the default 10, but not the old
values.
"""

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

# app.delete_account_data() from 0009 (DELETE /me), with or without the user's push
# subscriptions. Account deletion must remove them at once too: an endpoint and its keys are
# the user's data, and otherwise reminders could still reach the device until the worker
# deletes the auth user and the cascade runs.
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
        {push}DELETE FROM app.blocks WHERE user_id = uid;
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
"""
_PUSH_DELETE = "DELETE FROM app.push_subscriptions WHERE user_id = uid;\n        "


def upgrade() -> None:
    op.execute("""
        CREATE TABLE app.push_subscriptions (
            id uuid NOT NULL DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL,
            endpoint text NOT NULL,
            p256dh text NOT NULL,
            auth text NOT NULL,
            user_agent text,
            created_at timestamptz NOT NULL DEFAULT now(),
            last_success_at timestamptz,
            failure_count integer NOT NULL DEFAULT 0,
            CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id),
            CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id)
                REFERENCES auth.users (id) ON DELETE CASCADE,
            CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint),
            CONSTRAINT push_subscriptions_endpoint_format CHECK (
                left(endpoint, 8) = 'https://' AND char_length(endpoint) <= 2048
            ),
            CONSTRAINT push_subscriptions_p256dh_length
                CHECK (char_length(p256dh) BETWEEN 80 AND 100),
            CONSTRAINT push_subscriptions_auth_length CHECK (char_length(auth) BETWEEN 16 AND 30),
            CONSTRAINT push_subscriptions_user_agent_length
                CHECK (char_length(user_agent) <= 500),
            CONSTRAINT push_subscriptions_failure_count_range CHECK (failure_count >= 0)
        )
    """)
    op.execute("CREATE INDEX push_subscriptions_user_idx ON app.push_subscriptions (user_id)")
    op.execute("ALTER TABLE app.push_subscriptions ENABLE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY push_subscriptions_owner ON app.push_subscriptions FOR ALL TO authenticated
        USING (user_id = (SELECT auth.uid()))
        WITH CHECK (user_id = (SELECT auth.uid()))
    """)
    op.execute("GRANT SELECT, DELETE ON app.push_subscriptions TO authenticated")
    op.execute("""
        GRANT INSERT (user_id, endpoint, p256dh, auth, user_agent)
        ON app.push_subscriptions TO authenticated
    """)
    op.execute("""
        GRANT UPDATE (p256dh, auth, user_agent, failure_count)
        ON app.push_subscriptions TO authenticated
    """)

    op.execute("""
        CREATE FUNCTION app.take_push_endpoint(p_endpoint text) RETURNS void
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = ''
        AS $$
        DECLARE
            caller uuid := auth.uid();
        BEGIN
            IF caller IS NULL THEN
                RAISE EXCEPTION 'take_push_endpoint needs a signed-in user'
                    USING ERRCODE = 'insufficient_privilege';
            END IF;
            DELETE FROM app.push_subscriptions
            WHERE endpoint = p_endpoint AND user_id <> caller;
        END
        $$
    """)
    # Functions are executable by PUBLIC by default; anon and service_role are named too in
    # case default privileges granted them EXECUTE directly.
    op.execute(
        "REVOKE EXECUTE ON FUNCTION app.take_push_endpoint(text) FROM PUBLIC, anon, service_role"
    )
    op.execute("GRANT EXECUTE ON FUNCTION app.take_push_endpoint(text) TO authenticated")

    op.execute("ALTER TABLE app.blocks ADD COLUMN notified_at timestamptz")
    op.execute("""
        CREATE INDEX blocks_due_reminder_idx ON app.blocks (starts_at)
        WHERE status = 'planned' AND notified_at IS NULL
    """)
    op.execute("""
        CREATE FUNCTION app.blocks_reset_notified_at() RETURNS trigger
        LANGUAGE plpgsql
        SET search_path = ''
        AS $$
        BEGIN
            NEW.notified_at := NULL;
            RETURN NEW;
        END
        $$
    """)
    op.execute("""
        CREATE TRIGGER blocks_reset_notified_at
        BEFORE UPDATE OF starts_at ON app.blocks
        FOR EACH ROW
        WHEN (OLD.starts_at IS DISTINCT FROM NEW.starts_at)
        EXECUTE FUNCTION app.blocks_reset_notified_at()
    """)

    op.execute("ALTER TABLE app.profiles DROP CONSTRAINT profiles_notify_lead_minutes_range")
    op.execute("ALTER TABLE app.profiles ALTER COLUMN notify_lead_minutes SET DEFAULT 0")
    op.execute("""
        UPDATE app.profiles SET notify_lead_minutes = 0
        WHERE notify_lead_minutes NOT IN (0, 5, 15)
    """)
    op.execute("""
        ALTER TABLE app.profiles ADD CONSTRAINT profiles_notify_lead_minutes_valid
            CHECK (notify_lead_minutes IN (0, 5, 10, 15))
    """)

    # CREATE OR REPLACE keeps the owner, the REVOKE from PUBLIC and the GRANT of 0009.
    op.execute(_DELETE_ACCOUNT_DATA.replace("{push}", _PUSH_DELETE))


def downgrade() -> None:
    op.execute(_DELETE_ACCOUNT_DATA.replace("{push}", ""))
    op.execute("ALTER TABLE app.profiles DROP CONSTRAINT profiles_notify_lead_minutes_valid")
    op.execute("ALTER TABLE app.profiles ALTER COLUMN notify_lead_minutes SET DEFAULT 10")
    op.execute("""
        ALTER TABLE app.profiles ADD CONSTRAINT profiles_notify_lead_minutes_range
            CHECK (notify_lead_minutes BETWEEN 0 AND 120)
    """)

    op.execute("DROP TRIGGER blocks_reset_notified_at ON app.blocks")
    op.execute("DROP FUNCTION app.blocks_reset_notified_at()")
    op.execute("DROP INDEX app.blocks_due_reminder_idx")
    op.execute("ALTER TABLE app.blocks DROP COLUMN notified_at")

    op.execute("DROP FUNCTION app.take_push_endpoint(text)")
    op.execute("DROP TABLE app.push_subscriptions")
