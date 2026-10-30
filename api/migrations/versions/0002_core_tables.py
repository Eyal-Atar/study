"""Create profiles, exams, tasks and blocks with row level security

Explicit SQL, written by hand. Every table gets RLS, an owner policy and its grants in
this migration, so no table ever exists unprotected.
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE app.profiles (
            id uuid NOT NULL,
            display_name text,
            timezone text NOT NULL DEFAULT 'Asia/Jerusalem',
            wake_time time NOT NULL DEFAULT '08:00',
            sleep_time time NOT NULL DEFAULT '23:00',
            daily_study_minutes smallint NOT NULL DEFAULT 240,
            study_windows text[] NOT NULL DEFAULT '{morning,afternoon}',
            rest_days_before_exam smallint NOT NULL DEFAULT 1,
            notify_lead_minutes smallint NOT NULL DEFAULT 10,
            onboarding_completed_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT profiles_pkey PRIMARY KEY (id),
            CONSTRAINT profiles_id_fkey FOREIGN KEY (id)
                REFERENCES auth.users (id) ON DELETE CASCADE,
            CONSTRAINT profiles_display_name_length
                CHECK (char_length(display_name) BETWEEN 1 AND 100),
            CONSTRAINT profiles_timezone_length CHECK (char_length(timezone) BETWEEN 1 AND 64),
            CONSTRAINT profiles_wake_differs_from_sleep CHECK (wake_time <> sleep_time),
            CONSTRAINT profiles_daily_study_minutes_range
                CHECK (daily_study_minutes BETWEEN 30 AND 960),
            CONSTRAINT profiles_study_windows_valid CHECK (
                cardinality(study_windows) BETWEEN 1 AND 4
                AND study_windows <@ ARRAY['morning', 'afternoon', 'evening', 'night']
            ),
            CONSTRAINT profiles_rest_days_before_exam_range
                CHECK (rest_days_before_exam BETWEEN 0 AND 14),
            CONSTRAINT profiles_notify_lead_minutes_range
                CHECK (notify_lead_minutes BETWEEN 0 AND 120)
        )
    """)

    op.execute("""
        CREATE TABLE app.exams (
            id uuid NOT NULL DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL,
            name text NOT NULL,
            exam_date date NOT NULL,
            difficulty smallint NOT NULL DEFAULT 3,
            deleted_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT exams_pkey PRIMARY KEY (id),
            CONSTRAINT exams_user_id_fkey FOREIGN KEY (user_id)
                REFERENCES auth.users (id) ON DELETE CASCADE,
            CONSTRAINT exams_name_length
                CHECK (btrim(name) <> '' AND char_length(name) <= 200),
            CONSTRAINT exams_difficulty_range CHECK (difficulty BETWEEN 1 AND 5),
            CONSTRAINT exams_id_user_id_key UNIQUE (id, user_id)
        )
    """)
    op.execute("CREATE INDEX exams_user_exam_date_idx ON app.exams (user_id, exam_date)")

    op.execute("""
        CREATE TABLE app.tasks (
            id uuid NOT NULL DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL,
            exam_id uuid NOT NULL,
            title text NOT NULL,
            kind text NOT NULL,
            estimated_minutes smallint NOT NULL,
            focus smallint NOT NULL DEFAULT 5,
            depends_on_task_id uuid,
            status text NOT NULL DEFAULT 'todo',
            source text NOT NULL,
            deleted_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT tasks_pkey PRIMARY KEY (id),
            CONSTRAINT tasks_user_id_fkey FOREIGN KEY (user_id)
                REFERENCES auth.users (id) ON DELETE CASCADE,
            CONSTRAINT tasks_title_length
                CHECK (btrim(title) <> '' AND char_length(title) <= 200),
            CONSTRAINT tasks_kind_valid CHECK (
                kind IN ('learn', 'practice', 'review', 'simulation', 'simulation_review', 'custom')
            ),
            CONSTRAINT tasks_estimated_minutes_range CHECK (estimated_minutes BETWEEN 5 AND 600),
            CONSTRAINT tasks_focus_range CHECK (focus BETWEEN 1 AND 10),
            CONSTRAINT tasks_status_valid CHECK (status IN ('todo', 'done', 'skipped')),
            CONSTRAINT tasks_source_valid CHECK (source IN ('ai', 'user')),
            CONSTRAINT tasks_not_self_dependent CHECK (depends_on_task_id <> id),
            CONSTRAINT tasks_id_user_id_key UNIQUE (id, user_id),
            CONSTRAINT tasks_exam_fkey FOREIGN KEY (exam_id, user_id)
                REFERENCES app.exams (id, user_id) ON DELETE CASCADE,
            CONSTRAINT tasks_depends_on_fkey FOREIGN KEY (depends_on_task_id, user_id)
                REFERENCES app.tasks (id, user_id) ON DELETE SET NULL (depends_on_task_id)
        )
    """)
    op.execute("CREATE INDEX tasks_user_exam_idx ON app.tasks (user_id, exam_id)")
    op.execute("""
        CREATE INDEX tasks_depends_on_idx ON app.tasks (depends_on_task_id)
        WHERE depends_on_task_id IS NOT NULL
    """)

    op.execute("""
        CREATE TABLE app.blocks (
            id uuid NOT NULL DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL,
            task_id uuid NOT NULL,
            starts_at timestamptz NOT NULL,
            ends_at timestamptz NOT NULL,
            part_index smallint NOT NULL DEFAULT 1,
            part_count smallint NOT NULL DEFAULT 1,
            pinned boolean NOT NULL DEFAULT false,
            status text NOT NULL DEFAULT 'planned',
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT blocks_pkey PRIMARY KEY (id),
            CONSTRAINT blocks_user_id_fkey FOREIGN KEY (user_id)
                REFERENCES auth.users (id) ON DELETE CASCADE,
            CONSTRAINT blocks_ends_after_starts CHECK (ends_at > starts_at),
            CONSTRAINT blocks_part_count_positive CHECK (part_count >= 1),
            CONSTRAINT blocks_part_index_range CHECK (part_index BETWEEN 1 AND part_count),
            CONSTRAINT blocks_status_valid
                CHECK (status IN ('planned', 'done', 'missed', 'skipped')),
            CONSTRAINT blocks_task_fkey FOREIGN KEY (task_id, user_id)
                REFERENCES app.tasks (id, user_id) ON DELETE CASCADE
        )
    """)
    op.execute("CREATE INDEX blocks_user_starts_at_idx ON app.blocks (user_id, starts_at)")
    op.execute("CREATE INDEX blocks_task_idx ON app.blocks (task_id)")

    for table, owner_column in (
        ("profiles", "id"),
        ("exams", "user_id"),
        ("tasks", "user_id"),
        ("blocks", "user_id"),
    ):
        op.execute(f"ALTER TABLE app.{table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"""
            CREATE POLICY {table}_owner ON app.{table} FOR ALL TO authenticated
            USING ({owner_column} = (SELECT auth.uid()))
            WITH CHECK ({owner_column} = (SELECT auth.uid()))
        """)

    # A profile is deleted only together with the account, so it gets no DELETE.
    op.execute("GRANT SELECT, INSERT, UPDATE ON app.profiles TO authenticated")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON app.exams TO authenticated")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON app.tasks TO authenticated")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON app.blocks TO authenticated")


def downgrade() -> None:
    op.execute("DROP TABLE app.blocks, app.tasks, app.exams, app.profiles")
