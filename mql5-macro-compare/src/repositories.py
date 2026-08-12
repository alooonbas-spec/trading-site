"""Thin data-access layer over the SQLAlchemy models.

Keeps upsert / dedup logic in one place so services never write raw SQL
and never risk creating duplicate observations.
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from src.models import (
    AppSetting,
    Indicator,
    IndicatorTranslation,
    Observation,
    SyncError,
    SyncJob,
    utcnow,
)


class IndicatorRepository:
    def __init__(self, session: Session):
        self.session = session

    def get_by_slug(self, slug: str) -> Indicator | None:
        return self.session.scalar(select(Indicator).where(Indicator.slug == slug))

    def get_by_id(self, indicator_id: int) -> Indicator | None:
        return self.session.get(Indicator, indicator_id)

    def list_all(self) -> list[Indicator]:
        return list(self.session.scalars(select(Indicator).order_by(Indicator.canonical_name)))

    def upsert(self, **fields) -> tuple[Indicator, bool]:
        """Insert a new indicator or update an existing one by slug.

        Returns (indicator, created). Never adds a duplicate slug.
        """
        slug = fields["slug"]
        existing = self.get_by_slug(slug)
        if existing:
            for key, value in fields.items():
                if value is not None:
                    setattr(existing, key, value)
            self.session.flush()
            return existing, False

        indicator = Indicator(**fields)
        self.session.add(indicator)
        self.session.flush()
        return indicator, True

    def set_translation(self, indicator_id: int, locale: str, **fields) -> IndicatorTranslation:
        existing = self.session.scalar(
            select(IndicatorTranslation).where(
                IndicatorTranslation.indicator_id == indicator_id,
                IndicatorTranslation.locale == locale,
            )
        )
        if existing:
            for key, value in fields.items():
                setattr(existing, key, value)
            self.session.flush()
            return existing

        translation = IndicatorTranslation(indicator_id=indicator_id, locale=locale, **fields)
        self.session.add(translation)
        self.session.flush()
        return translation

    def mark_sync_status(self, indicator_id: int, status: str, when: dt.datetime | None = None) -> None:
        indicator = self.get_by_id(indicator_id)
        if not indicator:
            return
        indicator.sync_status = status
        if when is not None:
            indicator.last_updated_at = when
        self.session.flush()


class ObservationRepository:
    def __init__(self, session: Session):
        self.session = session

    def existing_release_dates(self, indicator_id: int) -> set[tuple[dt.date, str]]:
        rows = self.session.execute(
            select(Observation.release_date, Observation.reference_period).where(
                Observation.indicator_id == indicator_id
            )
        ).all()
        return {(r[0], r[1]) for r in rows}

    def bulk_upsert(self, indicator_id: int, rows: list[dict]) -> tuple[int, int]:
        """Insert new observations, update ones that changed. Returns (inserted, updated).

        Dedup key: (indicator_id, release_date, reference_period) - matches the
        DB unique constraint, so this is safe to call repeatedly (idempotent
        incremental sync).
        """
        inserted = 0
        updated = 0
        existing_map = {
            (o.release_date, o.reference_period): o
            for o in self.session.scalars(
                select(Observation).where(Observation.indicator_id == indicator_id)
            )
        }
        for row in rows:
            key = (row["release_date"], row.get("reference_period", ""))
            existing = existing_map.get(key)
            if existing:
                changed = False
                for field in ("actual", "forecast", "previous", "actual_raw", "forecast_raw", "previous_raw",
                              "unit", "is_preliminary", "is_revised", "source_url"):
                    if field in row and getattr(existing, field) != row[field]:
                        setattr(existing, field, row[field])
                        changed = True
                if changed:
                    existing.fetched_at = utcnow()
                    updated += 1
            else:
                obs = Observation(indicator_id=indicator_id, **row)
                self.session.add(obs)
                inserted += 1
        self.session.flush()
        return inserted, updated

    def for_indicators(self, indicator_ids: list[int], start: dt.date | None = None,
                        end: dt.date | None = None) -> list[Observation]:
        stmt = select(Observation).where(Observation.indicator_id.in_(indicator_ids))
        if start is not None:
            stmt = stmt.where(Observation.release_date >= start)
        if end is not None:
            stmt = stmt.where(Observation.release_date <= end)
        stmt = stmt.order_by(Observation.release_date)
        return list(self.session.scalars(stmt))

    def stats_for_indicator(self, indicator_id: int) -> dict:
        rows = list(self.session.scalars(select(Observation).where(Observation.indicator_id == indicator_id)))
        if not rows:
            return {"count": 0, "first_date": None, "last_date": None}
        dates = [r.release_date for r in rows]
        return {"count": len(rows), "first_date": min(dates), "last_date": max(dates)}


class SyncJobRepository:
    def __init__(self, session: Session):
        self.session = session

    def create(self, job_type: str, total_items: int) -> SyncJob:
        job = SyncJob(job_type=job_type, status="running", total_items=total_items, started_at=utcnow())
        self.session.add(job)
        self.session.flush()
        return job

    def get(self, job_id: int) -> SyncJob | None:
        return self.session.get(SyncJob, job_id)

    def latest(self, job_type: str | None = None) -> SyncJob | None:
        stmt = select(SyncJob).order_by(SyncJob.id.desc())
        if job_type:
            stmt = stmt.where(SyncJob.job_type == job_type)
        return self.session.scalars(stmt).first()

    def request_cancel(self, job_id: int) -> None:
        job = self.get(job_id)
        if job:
            job.cancel_requested = True
            self.session.flush()

    def update_progress(self, job_id: int, *, processed: int | None = None, successful: int | None = None,
                         failed: int | None = None, status: str | None = None) -> None:
        job = self.get(job_id)
        if not job:
            return
        if processed is not None:
            job.processed_items = processed
        if successful is not None:
            job.successful_items = successful
        if failed is not None:
            job.failed_items = failed
        if status is not None:
            job.status = status
            if status in ("completed", "cancelled", "failed"):
                job.finished_at = utcnow()
        self.session.flush()


class SyncErrorRepository:
    def __init__(self, session: Session):
        self.session = session

    def add(self, *, indicator_id: int | None, job_id: int | None, error_type: str,
             error_message: str, attempt: int) -> SyncError:
        err = SyncError(
            indicator_id=indicator_id, job_id=job_id, error_type=error_type,
            error_message=error_message[:4000], attempt=attempt,
        )
        self.session.add(err)
        self.session.flush()
        return err

    def recent(self, limit: int = 100) -> list[SyncError]:
        return list(self.session.scalars(select(SyncError).order_by(SyncError.id.desc()).limit(limit)))

    def failed_indicator_ids(self, job_id: int | None = None) -> list[int]:
        stmt = select(SyncError.indicator_id).where(SyncError.indicator_id.is_not(None))
        if job_id is not None:
            stmt = stmt.where(SyncError.job_id == job_id)
        return list({r[0] for r in self.session.execute(stmt).all()})


class AppSettingRepository:
    def __init__(self, session: Session):
        self.session = session

    def get(self, key: str, default: str | None = None) -> str | None:
        setting = self.session.get(AppSetting, key)
        return setting.value if setting else default

    def set(self, key: str, value: str) -> None:
        setting = self.session.get(AppSetting, key)
        if setting:
            setting.value = value
        else:
            self.session.add(AppSetting(key=key, value=value))
        self.session.flush()
