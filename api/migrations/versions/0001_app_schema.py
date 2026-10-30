"""Create the studyflow_api role and the privileges on the app schema

Explicit SQL, written by hand.
"""

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'studyflow_api') THEN
                CREATE ROLE studyflow_api LOGIN NOINHERIT;
            END IF;
        END
        $$
    """)
    # In case the role was created by hand without it. The migration role needs ADMIN on
    # studyflow_api: true when this migration or `postgres` itself created it (Postgres 16+
    # grants the creator ADMIN), which is how the setup instructions create it.
    op.execute("ALTER ROLE studyflow_api NOINHERIT")
    # From Postgres 16 the role attribute only sets the default for new grants, so the
    # options are written on the grant itself.
    op.execute("GRANT authenticated TO studyflow_api WITH INHERIT FALSE, SET TRUE")
    op.execute("REVOKE ALL ON SCHEMA app FROM PUBLIC")
    op.execute("GRANT USAGE ON SCHEMA app TO authenticated")


def downgrade() -> None:
    # The role is shared by the whole cluster and the app schema holds alembic_version,
    # so both stay.
    op.execute("REVOKE USAGE ON SCHEMA app FROM authenticated")
    op.execute("REVOKE authenticated FROM studyflow_api")
