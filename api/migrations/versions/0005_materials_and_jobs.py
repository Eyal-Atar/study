"""Add materials (uploaded study files) and jobs (a small Postgres job queue)

Explicit SQL, written by hand.

`authenticated` gets column-level INSERT and UPDATE grants only. They fix who may change
each group of columns on `materials`: the registration columns (id, owner, exam, path, name,
kind, mime, size) are set once by the client on INSERT and are frozen after that; the ingest
result columns are not insertable and are written by the worker, which updates them under
the user's own RLS session (hence their UPDATE grant); queue state lives in `jobs` and
belongs to the worker only. They do not limit what a user could write into the result
columns of their own row through a future endpoint that updated them. On `jobs` a user
may only enqueue (user_id, kind, payload) and read their own rows: no UPDATE and no DELETE,
so nobody can mark a job done, reset its attempts or erase its error. The worker, which runs
as the owner role, is the only writer of status, attempts, locks and results.

`storage_path` must equal `user_id/exam_id/id`. Storage policies key on the first path
segment, so a CHECK that ties the path to the row's own ids stops a user from registering a
file inside another user's folder, and makes the path unguessable-by-construction and unique
per row. The composite foreign key (exam_id, user_id) keeps a material inside its owner's
own exams.

`jobs.run_at` and `jobs.created_at` default to clock_timestamp() rather than now(): now() is
the start of the transaction, so jobs enqueued in one transaction would tie, and a job
enqueued late in a long transaction would sort before one committed earlier. The wall clock
at insert time keeps the queue order equal to the enqueue order.
"""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE app.materials (
            id uuid NOT NULL DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL,
            exam_id uuid NOT NULL,
            storage_path text NOT NULL,
            filename text NOT NULL,
            kind text NOT NULL,
            mime text NOT NULL,
            size_bytes bigint NOT NULL,
            page_count smallint,
            scanned_pages smallint,
            ingest_status text NOT NULL DEFAULT 'queued',
            ingest_error text,
            warnings text[] NOT NULL DEFAULT '{}',
            text_by_page jsonb,
            created_at timestamptz NOT NULL DEFAULT now(),
            ingested_at timestamptz,
            CONSTRAINT materials_pkey PRIMARY KEY (id),
            CONSTRAINT materials_user_id_fkey FOREIGN KEY (user_id)
                REFERENCES auth.users (id) ON DELETE CASCADE,
            CONSTRAINT materials_exam_fkey FOREIGN KEY (exam_id, user_id)
                REFERENCES app.exams (id, user_id) ON DELETE CASCADE,
            CONSTRAINT materials_id_user_id_key UNIQUE (id, user_id),
            CONSTRAINT materials_storage_path_key UNIQUE (storage_path),
            CONSTRAINT materials_storage_path_format CHECK (
                storage_path = user_id::text || '/' || exam_id::text || '/' || id::text
            ),
            CONSTRAINT materials_filename_length CHECK (
                btrim(filename) <> '' AND char_length(filename) <= 255
            ),
            CONSTRAINT materials_kind_valid CHECK (
                kind IN ('syllabus', 'summary', 'past_exam', 'solution', 'notes', 'other')
            ),
            CONSTRAINT materials_mime_format CHECK (
                mime ~ '^[a-z]+/[a-z0-9.+-]+$' AND char_length(mime) <= 100
            ),
            CONSTRAINT materials_size_bytes_range CHECK (size_bytes BETWEEN 1 AND 1073741824),
            CONSTRAINT materials_page_count_range CHECK (
                page_count IS NULL OR page_count BETWEEN 0 AND 10000
            ),
            CONSTRAINT materials_scanned_pages_range CHECK (
                scanned_pages IS NULL OR scanned_pages BETWEEN 0 AND 10000
            ),
            CONSTRAINT materials_ingest_status_valid CHECK (
                ingest_status IN ('queued', 'processing', 'ready', 'failed')
            ),
            CONSTRAINT materials_ingest_error_format CHECK (
                ingest_error IS NULL OR ingest_error ~ '^[a-z][a-z_]{0,59}$'
            ),
            CONSTRAINT materials_warnings_valid CHECK (
                coalesce(array_ndims(warnings), 1) = 1 AND cardinality(warnings) <= 10
            ),
            CONSTRAINT materials_text_by_page_shape CHECK (
                text_by_page IS NULL OR jsonb_typeof(text_by_page) = 'array'
            ),
            CONSTRAINT materials_text_by_page_size CHECK (
                pg_column_size(text_by_page) <= 8388608
            ),
            CONSTRAINT materials_ready_is_complete CHECK (
                ingest_status <> 'ready' OR (
                    page_count IS NOT NULL AND scanned_pages IS NOT NULL
                    AND text_by_page IS NOT NULL AND ingested_at IS NOT NULL
                )
            ),
            CONSTRAINT materials_failed_has_error CHECK (
                ingest_status <> 'failed' OR ingest_error IS NOT NULL
            )
        )
    """)
    op.execute("""
        CREATE INDEX materials_user_exam_idx ON app.materials (user_id, exam_id, created_at)
    """)
    op.execute("ALTER TABLE app.materials ENABLE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY materials_owner ON app.materials FOR ALL TO authenticated
        USING (user_id = (SELECT auth.uid()))
        WITH CHECK (user_id = (SELECT auth.uid()))
    """)
    op.execute("GRANT SELECT, DELETE ON app.materials TO authenticated")
    op.execute("""
        GRANT INSERT (id, user_id, exam_id, storage_path, filename, kind, mime, size_bytes)
        ON app.materials TO authenticated
    """)
    op.execute("""
        GRANT UPDATE (
            ingest_status, ingest_error, page_count, scanned_pages, warnings, text_by_page,
            ingested_at
        ) ON app.materials TO authenticated
    """)

    op.execute("""
        CREATE TABLE app.jobs (
            id uuid NOT NULL DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL,
            kind text NOT NULL,
            payload jsonb NOT NULL DEFAULT '{}'::jsonb,
            status text NOT NULL DEFAULT 'queued',
            run_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            attempts smallint NOT NULL DEFAULT 0,
            max_attempts smallint NOT NULL DEFAULT 3,
            locked_at timestamptz,
            stage text,
            percent smallint,
            error text,
            result jsonb,
            created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            started_at timestamptz,
            finished_at timestamptz,
            CONSTRAINT jobs_pkey PRIMARY KEY (id),
            CONSTRAINT jobs_user_id_fkey FOREIGN KEY (user_id)
                REFERENCES auth.users (id) ON DELETE CASCADE,
            CONSTRAINT jobs_id_user_id_key UNIQUE (id, user_id),
            CONSTRAINT jobs_kind_format CHECK (kind ~ '^[a-z][a-z_]{0,39}$'),
            CONSTRAINT jobs_payload_shape CHECK (jsonb_typeof(payload) = 'object'),
            CONSTRAINT jobs_payload_size CHECK (pg_column_size(payload) <= 65536),
            CONSTRAINT jobs_status_valid CHECK (status IN ('queued', 'running', 'done', 'failed')),
            CONSTRAINT jobs_attempts_range CHECK (
                attempts >= 0 AND max_attempts BETWEEN 1 AND 10
            ),
            CONSTRAINT jobs_stage_format CHECK (stage IS NULL OR stage ~ '^[a-z][a-z_]{0,39}$'),
            CONSTRAINT jobs_percent_range CHECK (percent IS NULL OR percent BETWEEN 0 AND 100),
            CONSTRAINT jobs_error_format CHECK (error IS NULL OR error ~ '^[a-z][a-z_]{0,59}$'),
            CONSTRAINT jobs_result_shape CHECK (
                result IS NULL OR jsonb_typeof(result) = 'object'
            ),
            CONSTRAINT jobs_result_size CHECK (pg_column_size(result) <= 65536)
        )
    """)
    op.execute("CREATE INDEX jobs_queued_idx ON app.jobs (run_at) WHERE status = 'queued'")
    op.execute("CREATE INDEX jobs_running_idx ON app.jobs (locked_at) WHERE status = 'running'")
    op.execute("CREATE INDEX jobs_user_created_idx ON app.jobs (user_id, created_at DESC)")
    op.execute("ALTER TABLE app.jobs ENABLE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY jobs_owner ON app.jobs FOR ALL TO authenticated
        USING (user_id = (SELECT auth.uid()))
        WITH CHECK (user_id = (SELECT auth.uid()))
    """)
    op.execute("GRANT SELECT ON app.jobs TO authenticated")
    op.execute("GRANT INSERT (user_id, kind, payload) ON app.jobs TO authenticated")


def downgrade() -> None:
    op.execute("DROP TABLE app.jobs, app.materials")
