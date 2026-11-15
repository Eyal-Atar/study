"""Add topics and link tasks to topics and materials, with a task ordering column

Explicit SQL, written by hand.

`tasks.topic_id` and `tasks.material_id` use composite foreign keys that include both
`exam_id` and `user_id`. A plain `user_id` key would only stop a task from pointing at a
row of another user; the triple also stops it from pointing at a topic or material of a
different exam of the same user. That is why `topics` and `materials` both get a
`UNIQUE (id, exam_id, user_id)` for the keys to reference.

The foreign keys use `ON DELETE SET NULL (topic_id)` / `(material_id)`, naming only the
referencing column. A plain SET NULL would also null `exam_id` and `user_id`, which are NOT
NULL and must never change; deleting a topic or a material (a hard delete, see S10) must
leave the task, and its simulation or practice, in place.

`tasks.position` keeps the order in which the analysis listed its tasks, so the planner
and the API load them in that order. It is nullable because a task the user adds by hand
has no place in the analysis order; such tasks sort after the analysed ones, by creation
time (ORDER BY position NULLS LAST, created_at, id).
"""

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE app.topics (
            id uuid NOT NULL DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL,
            exam_id uuid NOT NULL,
            name text NOT NULL,
            weight smallint NOT NULL,
            evidence text,
            position integer NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT topics_pkey PRIMARY KEY (id),
            CONSTRAINT topics_user_id_fkey FOREIGN KEY (user_id)
                REFERENCES auth.users (id) ON DELETE CASCADE,
            CONSTRAINT topics_exam_fkey FOREIGN KEY (exam_id, user_id)
                REFERENCES app.exams (id, user_id) ON DELETE CASCADE,
            CONSTRAINT topics_id_user_id_key UNIQUE (id, user_id),
            CONSTRAINT topics_id_exam_user_key UNIQUE (id, exam_id, user_id),
            CONSTRAINT topics_name_length CHECK (btrim(name) <> '' AND char_length(name) <= 120),
            CONSTRAINT topics_weight_range CHECK (weight BETWEEN 1 AND 5),
            CONSTRAINT topics_evidence_length CHECK (
                evidence IS NULL OR char_length(evidence) <= 500
            ),
            CONSTRAINT topics_position_range CHECK (position BETWEEN 1 AND 10000)
        )
    """)
    op.execute("CREATE INDEX topics_user_exam_idx ON app.topics (user_id, exam_id, position)")
    op.execute("ALTER TABLE app.topics ENABLE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY topics_owner ON app.topics FOR ALL TO authenticated
        USING (user_id = (SELECT auth.uid()))
        WITH CHECK (user_id = (SELECT auth.uid()))
    """)
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON app.topics TO authenticated")

    op.execute("""
        ALTER TABLE app.materials
            ADD CONSTRAINT materials_id_exam_user_key UNIQUE (id, exam_id, user_id)
    """)

    op.execute("""
        ALTER TABLE app.tasks
            ADD COLUMN topic_id uuid,
            ADD COLUMN material_id uuid,
            ADD COLUMN position integer,
            ADD CONSTRAINT tasks_position_range CHECK (
                position IS NULL OR position BETWEEN 1 AND 10000
            ),
            ADD CONSTRAINT tasks_topic_fkey FOREIGN KEY (topic_id, exam_id, user_id)
                REFERENCES app.topics (id, exam_id, user_id) ON DELETE SET NULL (topic_id),
            ADD CONSTRAINT tasks_material_fkey FOREIGN KEY (material_id, exam_id, user_id)
                REFERENCES app.materials (id, exam_id, user_id) ON DELETE SET NULL (material_id)
    """)
    op.execute("CREATE INDEX tasks_topic_idx ON app.tasks (topic_id) WHERE topic_id IS NOT NULL")
    op.execute(
        "CREATE INDEX tasks_material_idx ON app.tasks (material_id) WHERE material_id IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX app.tasks_material_idx")
    op.execute("DROP INDEX app.tasks_topic_idx")
    op.execute("""
        ALTER TABLE app.tasks
            DROP CONSTRAINT tasks_material_fkey,
            DROP CONSTRAINT tasks_topic_fkey,
            DROP CONSTRAINT tasks_position_range,
            DROP COLUMN position,
            DROP COLUMN material_id,
            DROP COLUMN topic_id
    """)
    op.execute("ALTER TABLE app.materials DROP CONSTRAINT materials_id_exam_user_key")
    op.execute("DROP TABLE app.topics")
