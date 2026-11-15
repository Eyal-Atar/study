"""Create the private `materials` Storage bucket and its per-user policies

Explicit SQL, written by hand.

Browsers upload study files straight into Storage under `{user_id}/{exam_id}/{material_id}`,
and the policies on `storage.objects` decide who may write and read. Uploads are allowed only
two folders deep and only under the caller's own user id; reads only under the caller's own
user id. There is no UPDATE and no DELETE policy, so with RLS on, a user can neither rename,
overwrite nor remove a stored file: the worker (service role) is the only one that does.

This migration never alters `storage.objects`. On Supabase that table is owned by
`supabase_storage_admin`, so `ALTER TABLE` (even `ENABLE ROW LEVEL SECURITY`) fails for the
migration role with "must be owner of table objects". RLS is already enabled there, and
`CREATE POLICY` and `INSERT INTO storage.buckets` are allowed. The test database imitates
this in tests/db/supabase_shim.sql.

`file_size_limit` (20 MiB) and `allowed_mime_types` are enforced by Storage itself. The size
must stay equal to `MAX_MATERIAL_BYTES` in app/config.py.

`downgrade` removes the policies and the bucket. Deleting the bucket fails while it still
holds objects; that is intended, so a downgrade cannot silently orphan users' files.
"""

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        VALUES (
            'materials', 'materials', false, 20971520,
            ARRAY['application/pdf', 'image/jpeg', 'image/png']
        )
        ON CONFLICT (id) DO UPDATE SET
            public = EXCLUDED.public,
            file_size_limit = EXCLUDED.file_size_limit,
            allowed_mime_types = EXCLUDED.allowed_mime_types
    """)
    op.execute("""
        CREATE POLICY materials_upload_own ON storage.objects
            FOR INSERT TO authenticated
            WITH CHECK (
                bucket_id = 'materials'
                AND array_length(storage.foldername(name), 1) = 2
                AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
            )
    """)
    op.execute("""
        CREATE POLICY materials_read_own ON storage.objects
            FOR SELECT TO authenticated
            USING (
                bucket_id = 'materials'
                AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
            )
    """)


def downgrade() -> None:
    op.execute("DROP POLICY materials_read_own ON storage.objects")
    op.execute("DROP POLICY materials_upload_own ON storage.objects")
    op.execute("DELETE FROM storage.buckets WHERE id = 'materials'")
