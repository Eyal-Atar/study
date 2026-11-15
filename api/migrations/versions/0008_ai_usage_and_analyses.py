"""Add ai_usage and analyses, and link tasks, topics and plan versions to an analysis

Explicit SQL, written by hand.

`analyses` keeps one AI analysis of one exam: the validated output, the status of the
draft (`draft`, `applied`, `failed`, `superseded`, `undone`), and what applying it replaced
(`replaced_task_ids`, used by undo). The worker writes it on behalf of the user and the API
applies it, so `authenticated` gets SELECT, INSERT, and UPDATE on the lifecycle columns only
(status, applied_at, undone_at, replaced_task_ids); never DELETE.

`ai_usage` is the spending ledger behind the daily quota: one row per call to Claude,
written by the worker as the schema owner, read-only for the user. `exam_id` has no foreign
key on purpose: a hard-deleted exam must not erase the record of money already spent. The
`job_id` foreign key uses `ON DELETE SET NULL (job_id)` for the same reason.

`tasks.analysis_id`, `topics.analysis_id` and `plan_versions.analysis_id` use a composite
key `(analysis_id, user_id)` so a row can never point at another user's analysis. They use
`ON DELETE SET NULL (analysis_id)`, naming only the referencing column, because a plain
SET NULL would also null `user_id`, which is NOT NULL.

The INSERT column grant on `plan_versions` was set in 0004; it is re-issued here with
`analysis_id` added (a column grant cannot be extended in place) and restored in downgrade.
"""

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE app.analyses (
            id uuid NOT NULL DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL,
            exam_id uuid NOT NULL,
            job_id uuid,
            status text NOT NULL,
            error text,
            output jsonb,
            material_keys jsonb NOT NULL DEFAULT '{}'::jsonb,
            warnings text[],
            dropped text[],
            total_minutes integer,
            budget_minutes integer,
            replaced_task_ids uuid[] NOT NULL DEFAULT '{}',
            created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            applied_at timestamptz,
            undone_at timestamptz,
            CONSTRAINT analyses_pkey PRIMARY KEY (id),
            CONSTRAINT analyses_user_id_fkey FOREIGN KEY (user_id)
                REFERENCES auth.users (id) ON DELETE CASCADE,
            CONSTRAINT analyses_exam_fkey FOREIGN KEY (exam_id, user_id)
                REFERENCES app.exams (id, user_id) ON DELETE CASCADE,
            CONSTRAINT analyses_job_fkey FOREIGN KEY (job_id, user_id)
                REFERENCES app.jobs (id, user_id) ON DELETE SET NULL (job_id),
            CONSTRAINT analyses_id_user_id_key UNIQUE (id, user_id),
            CONSTRAINT analyses_status_valid CHECK (
                status IN ('draft', 'applied', 'failed', 'superseded', 'undone')
            ),
            CONSTRAINT analyses_error_format CHECK (
                error IS NULL OR error ~ '^[a-z][a-z_]{0,59}$'
            ),
            CONSTRAINT analyses_error_iff_failed CHECK (
                (status = 'failed') = (error IS NOT NULL)
            ),
            CONSTRAINT analyses_output_shape CHECK (
                output IS NULL OR jsonb_typeof(output) = 'object'
            ),
            CONSTRAINT analyses_output_required CHECK (
                status NOT IN ('draft', 'applied') OR output IS NOT NULL
            ),
            CONSTRAINT analyses_output_size CHECK (
                output IS NULL OR pg_column_size(output) <= 1048576
            ),
            CONSTRAINT analyses_material_keys_shape CHECK (
                jsonb_typeof(material_keys) = 'object'
            ),
            CONSTRAINT analyses_warnings_shape CHECK (
                warnings IS NULL
                OR cardinality(warnings) = 0
                OR (array_ndims(warnings) = 1 AND cardinality(warnings) <= 20)
            ),
            CONSTRAINT analyses_dropped_shape CHECK (
                dropped IS NULL
                OR cardinality(dropped) = 0
                OR (array_ndims(dropped) = 1 AND cardinality(dropped) <= 150)
            ),
            CONSTRAINT analyses_total_minutes_range CHECK (
                total_minutes IS NULL OR total_minutes >= 0
            ),
            CONSTRAINT analyses_budget_minutes_range CHECK (
                budget_minutes IS NULL OR budget_minutes BETWEEN 0 AND 100000
            )
        )
    """)
    op.execute(
        "CREATE INDEX analyses_user_exam_idx ON app.analyses (user_id, exam_id, created_at DESC)"
    )
    op.execute("CREATE INDEX analyses_job_idx ON app.analyses (job_id)")
    op.execute("ALTER TABLE app.analyses ENABLE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY analyses_owner ON app.analyses FOR ALL TO authenticated
        USING (user_id = (SELECT auth.uid()))
        WITH CHECK (user_id = (SELECT auth.uid()))
    """)
    op.execute("GRANT SELECT, INSERT ON app.analyses TO authenticated")
    op.execute(
        "GRANT UPDATE (status, applied_at, undone_at, replaced_task_ids) "
        "ON app.analyses TO authenticated"
    )

    op.execute("""
        CREATE TABLE app.ai_usage (
            id uuid NOT NULL DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL,
            job_id uuid,
            exam_id uuid,
            model text NOT NULL,
            input_tokens integer NOT NULL DEFAULT 0,
            output_tokens integer NOT NULL DEFAULT 0,
            cache_creation_input_tokens integer NOT NULL DEFAULT 0,
            cache_read_input_tokens integer NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            CONSTRAINT ai_usage_pkey PRIMARY KEY (id),
            CONSTRAINT ai_usage_user_id_fkey FOREIGN KEY (user_id)
                REFERENCES auth.users (id) ON DELETE CASCADE,
            CONSTRAINT ai_usage_job_fkey FOREIGN KEY (job_id, user_id)
                REFERENCES app.jobs (id, user_id) ON DELETE SET NULL (job_id),
            CONSTRAINT ai_usage_model_length CHECK (char_length(model) BETWEEN 1 AND 100),
            CONSTRAINT ai_usage_input_tokens_range CHECK (input_tokens >= 0),
            CONSTRAINT ai_usage_output_tokens_range CHECK (output_tokens >= 0),
            CONSTRAINT ai_usage_cache_creation_range CHECK (cache_creation_input_tokens >= 0),
            CONSTRAINT ai_usage_cache_read_range CHECK (cache_read_input_tokens >= 0)
        )
    """)
    op.execute("CREATE INDEX ai_usage_user_created_idx ON app.ai_usage (user_id, created_at)")
    op.execute("CREATE INDEX ai_usage_job_idx ON app.ai_usage (job_id)")
    op.execute("ALTER TABLE app.ai_usage ENABLE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY ai_usage_owner ON app.ai_usage FOR ALL TO authenticated
        USING (user_id = (SELECT auth.uid()))
        WITH CHECK (user_id = (SELECT auth.uid()))
    """)
    op.execute("GRANT SELECT ON app.ai_usage TO authenticated")

    for table in ("tasks", "topics", "plan_versions"):
        op.execute(f"""
            ALTER TABLE app.{table}
                ADD COLUMN analysis_id uuid,
                ADD CONSTRAINT {table}_analysis_fkey FOREIGN KEY (analysis_id, user_id)
                    REFERENCES app.analyses (id, user_id) ON DELETE SET NULL (analysis_id)
        """)
        op.execute(
            f"CREATE INDEX {table}_analysis_idx ON app.{table} (analysis_id) "
            "WHERE analysis_id IS NOT NULL"
        )
    op.execute("REVOKE INSERT ON app.plan_versions FROM authenticated")
    op.execute("""
        GRANT INSERT (user_id, reason, snapshot, exam_id, task_id, task_before, analysis_id)
        ON app.plan_versions TO authenticated
    """)


def downgrade() -> None:
    op.execute("REVOKE INSERT ON app.plan_versions FROM authenticated")
    op.execute("""
        GRANT INSERT (user_id, reason, snapshot, exam_id, task_id, task_before)
        ON app.plan_versions TO authenticated
    """)
    for table in ("plan_versions", "topics", "tasks"):
        op.execute(f"DROP INDEX app.{table}_analysis_idx")
        op.execute(f"""
            ALTER TABLE app.{table}
                DROP CONSTRAINT {table}_analysis_fkey,
                DROP COLUMN analysis_id
        """)
    op.execute("DROP TABLE app.ai_usage")
    op.execute("DROP TABLE app.analyses")
