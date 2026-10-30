"""${message}

Explicit SQL through op.execute, written by hand. No autogenerate: the schema is not
modelled in SQLAlchemy.
"""

from alembic import op

revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}


def upgrade() -> None:
    op.execute("SELECT 1")  # replace with the explicit SQL


def downgrade() -> None:
    op.execute("SELECT 1")  # replace with the explicit SQL
