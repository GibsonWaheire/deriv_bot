"""create referred_users

Revision ID: 6a420209
Revises:
Create Date: 2026-06-29

"""
from alembic import op
import sqlalchemy as sa

revision = '6a420209'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'referred_users',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('deriv_account_id', sa.String(length=64), nullable=False),
        sa.Column('utm_source', sa.String(length=128), nullable=True),
        sa.Column('utm_medium', sa.String(length=128), nullable=True),
        sa.Column('utm_campaign', sa.String(length=128), nullable=True),
        sa.Column('sidc', sa.String(length=256), nullable=True),
        sa.Column('referred_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('first_trade_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='false'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('deriv_account_id'),
    )
    op.create_index('ix_referred_users_deriv_account_id', 'referred_users', ['deriv_account_id'])


def downgrade() -> None:
    op.drop_index('ix_referred_users_deriv_account_id', table_name='referred_users')
    op.drop_table('referred_users')
