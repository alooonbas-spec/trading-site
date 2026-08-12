"""Database engine/session setup and safe schema initialization."""
from __future__ import annotations

import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import Session, sessionmaker

from src.config import settings
from src.models import Base

logger = logging.getLogger(__name__)

_engine = create_engine(
    f"sqlite:///{settings.database_path}",
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)


def get_engine():
    return _engine


def backup_database() -> Path | None:
    """Copy the current SQLite file aside before any schema change.

    Never deletes the working database; only ever adds a timestamped copy.
    """
    if not settings.database_path.exists():
        return None
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = settings.database_path.with_name(f"{settings.database_path.stem}.backup.{stamp}.db")
    shutil.copy2(settings.database_path, backup_path)
    logger.info("Database backed up to %s", backup_path)
    return backup_path


def init_db() -> None:
    """Create tables if missing. Never drops or truncates existing data."""
    inspector = inspect(_engine)
    existing_tables = set(inspector.get_table_names())
    target_tables = set(Base.metadata.tables.keys())

    if existing_tables and not target_tables.issubset(existing_tables):
        # Schema is changing (new tables since last run) - back up first.
        backup_database()

    Base.metadata.create_all(_engine)


def get_session() -> Session:
    return SessionLocal()
