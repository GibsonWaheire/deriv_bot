"""
ReferredUser — tracks users who signed up via affiliate link.
"""
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ReferredUser(Base):
    __tablename__ = "referred_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Deriv account ID (e.g. "CR90004580") — unique per referral
    deriv_account_id: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)

    # Affiliate tracking params captured from signup URL
    utm_source: Mapped[str | None]    = mapped_column(String(128), nullable=True)
    utm_medium: Mapped[str | None]    = mapped_column(String(128), nullable=True)
    utm_campaign: Mapped[str | None]  = mapped_column(String(128), nullable=True)
    sidc: Mapped[str | None]          = mapped_column(String(256), nullable=True)

    # Timestamps
    referred_at: Mapped[datetime]      = mapped_column(DateTime(timezone=True), default=_now)
    first_trade_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # State
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)   # True after first trade
