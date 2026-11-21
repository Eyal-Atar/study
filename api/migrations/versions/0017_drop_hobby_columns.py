"""Drop the S15 hobby columns from app.profiles

Explicit SQL, written by hand.

0014 (S35) moved every hobby into seven rows of `app.commitments` and set
`profiles.hobby_start` and `hobby_minutes` to NULL; since then the API read and wrote the
hobby only through the commitments (a compatibility layer on GET/PATCH /me). `app.services.hobby`
reads and writes the commitments, never the columns, so the columns are empty and unneeded:
this migration drops them with the three CHECKs 0009 put on them.

The downgrade adds the columns back empty (nullable) with the same three CHECKs, so 0014's
downgrade can run next: that is the one that refills them from the commitments that still
form a complete hobby set. Before applying this to a database that was not migrated by
0014 in one go, check `SELECT count(*) FROM app.profiles WHERE hobby_start IS NOT NULL`
is 0; a non-zero count is a hobby that was not moved and would be lost.
"""

from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE app.profiles
            DROP CONSTRAINT profiles_hobby_together,
            DROP CONSTRAINT profiles_hobby_minutes_range,
            DROP CONSTRAINT profiles_hobby_start_whole_minute,
            DROP COLUMN hobby_minutes,
            DROP COLUMN hobby_start
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE app.profiles
            ADD COLUMN hobby_start time,
            ADD COLUMN hobby_minutes smallint,
            ADD CONSTRAINT profiles_hobby_together
                CHECK ((hobby_start IS NULL) = (hobby_minutes IS NULL)),
            ADD CONSTRAINT profiles_hobby_minutes_range CHECK (hobby_minutes BETWEEN 15 AND 240),
            ADD CONSTRAINT profiles_hobby_start_whole_minute
                CHECK (extract(second FROM hobby_start) = 0)
    """)
