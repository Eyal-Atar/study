"""A stable colour per exam: exams.color_index (0-7), assigned by a trigger

Explicit SQL, written by hand.

Every screen of the redesign (S31-S34) paints a block, a chip and a bar in the colour of its
exam, so the colour is data, not a function of the exam's position in a list.

1. The column is `smallint NOT NULL CHECK (0-7)` with no default: the BEFORE INSERT trigger
   `exams_assign_color` fills it when it is NULL. A new exam gets the smallest number in 0-7
   that none of the user's live exams (`deleted_at IS NULL`) uses; when all eight are in use,
   `(number of live exams) % 8`, so the order simply continues. An explicit value in the
   INSERT is kept (a manual choice can use it later). The trigger takes a transaction-level
   advisory lock per user, so two concurrent inserts for one user cannot both read the same
   free colour; the second waits for the first to commit and then sees its row.
2. Existing exams are filled by `row_number()` per user in the order (deleted last,
   `created_at`, `id`), modulo 8. The live exams get the first colours, so a user with up to
   eight live exams has no duplicate even if an exam was deleted before.
3. Stability: deleting an exam changes no colour. An exam that a plan undo brings back keeps
   its own colour even if a newer exam took it meanwhile: two exams of one colour are better
   than an exam that changes colour without being asked.

The function runs as the caller (no SECURITY DEFINER): the user's own exams are what it must
count, and RLS shows exactly those. `SET search_path = ''` as in 0004 and 0010.
"""

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE app.exams ADD COLUMN color_index smallint")
    op.execute("""
        UPDATE app.exams AS e
        SET color_index = (n.position - 1) % 8
        FROM (
            SELECT id,
                   row_number() OVER (
                       PARTITION BY user_id
                       ORDER BY (deleted_at IS NOT NULL), created_at, id
                   ) AS position
            FROM app.exams
        ) AS n
        WHERE n.id = e.id
    """)
    op.execute("""
        ALTER TABLE app.exams
            ALTER COLUMN color_index SET NOT NULL,
            ADD CONSTRAINT exams_color_index_range CHECK (color_index BETWEEN 0 AND 7)
    """)
    op.execute("""
        CREATE FUNCTION app.exams_assign_color() RETURNS trigger
        LANGUAGE plpgsql
        SET search_path = ''
        AS $$
        DECLARE
            live_count integer;
            free_color smallint;
        BEGIN
            IF NEW.color_index IS NOT NULL THEN
                RETURN NEW;
            END IF;
            PERFORM pg_advisory_xact_lock(
                hashtextextended('app.exams.color_index:' || NEW.user_id::text, 0)
            );
            SELECT count(*) INTO live_count
            FROM app.exams
            WHERE user_id = NEW.user_id AND deleted_at IS NULL;
            SELECT candidate INTO free_color
            FROM generate_series(0, 7) AS candidate
            WHERE NOT EXISTS (
                SELECT 1 FROM app.exams
                WHERE user_id = NEW.user_id AND deleted_at IS NULL
                  AND color_index = candidate
            )
            ORDER BY candidate
            LIMIT 1;
            NEW.color_index := COALESCE(free_color, live_count % 8);
            RETURN NEW;
        END
        $$
    """)
    op.execute("""
        CREATE TRIGGER exams_assign_color
            BEFORE INSERT ON app.exams
            FOR EACH ROW EXECUTE FUNCTION app.exams_assign_color()
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER exams_assign_color ON app.exams")
    op.execute("DROP FUNCTION app.exams_assign_color()")
    op.execute("ALTER TABLE app.exams DROP COLUMN color_index")
