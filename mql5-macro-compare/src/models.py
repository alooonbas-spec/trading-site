"""SQLAlchemy ORM models matching the schema in the project spec."""
from __future__ import annotations

import datetime as dt

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class Base(DeclarativeBase):
    pass


class Indicator(Base):
    __tablename__ = "indicators"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    canonical_name: Mapped[str] = mapped_column(String(500), nullable=False)
    original_name: Mapped[str] = mapped_column(String(500), nullable=False)
    country_code: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    country_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    currency_code: Mapped[str] = mapped_column(String(8), nullable=False, default="")
    category_code: Mapped[str] = mapped_column(String(64), nullable=False, default="general", index=True)
    importance: Mapped[str] = mapped_column(String(16), nullable=False, default="medium")
    unit: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    frequency: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    source_name: Mapped[str] = mapped_column(String(128), nullable=False, default="MQL5")
    source_url: Mapped[str] = mapped_column(String(1000), nullable=False)
    last_updated_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    sync_status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", index=True)
    discovery_method: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    translations: Mapped[list["IndicatorTranslation"]] = relationship(
        back_populates="indicator", cascade="all, delete-orphan"
    )
    observations: Mapped[list["Observation"]] = relationship(
        back_populates="indicator", cascade="all, delete-orphan"
    )
    errors: Mapped[list["SyncError"]] = relationship(
        back_populates="indicator", cascade="all, delete-orphan"
    )


class IndicatorTranslation(Base):
    __tablename__ = "indicator_translations"
    __table_args__ = (UniqueConstraint("indicator_id", "locale", name="uq_indicator_locale"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    indicator_id: Mapped[int] = mapped_column(ForeignKey("indicators.id"), nullable=False)
    locale: Mapped[str] = mapped_column(String(8), nullable=False)
    display_name: Mapped[str] = mapped_column(String(500), nullable=False)
    short_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    category_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")

    indicator: Mapped[Indicator] = relationship(back_populates="translations")


class Observation(Base):
    __tablename__ = "observations"
    __table_args__ = (
        UniqueConstraint("indicator_id", "release_date", "reference_period", name="uq_indicator_release"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    indicator_id: Mapped[int] = mapped_column(ForeignKey("indicators.id"), nullable=False, index=True)
    release_date: Mapped[dt.date] = mapped_column(Date, nullable=False, index=True)
    reference_period: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    actual: Mapped[float | None] = mapped_column(Float, nullable=True)
    forecast: Mapped[float | None] = mapped_column(Float, nullable=True)
    previous: Mapped[float | None] = mapped_column(Float, nullable=True)
    actual_raw: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    forecast_raw: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    previous_raw: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    unit: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    is_preliminary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_revised: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    source_url: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    fetched_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    indicator: Mapped[Indicator] = relationship(back_populates="observations")


class SyncJob(Base):
    __tablename__ = "sync_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_type: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", index=True)
    total_items: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    processed_items: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    successful_items: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_items: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    started_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class SyncError(Base):
    __tablename__ = "sync_errors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    indicator_id: Mapped[int | None] = mapped_column(ForeignKey("indicators.id"), nullable=True)
    job_id: Mapped[int | None] = mapped_column(ForeignKey("sync_jobs.id"), nullable=True)
    error_type: Mapped[str] = mapped_column(String(64), nullable=False)
    error_message: Mapped[str] = mapped_column(Text, nullable=False)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    indicator: Mapped[Indicator | None] = relationship(back_populates="errors")


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False, default="")
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)
