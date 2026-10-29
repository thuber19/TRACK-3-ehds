"""Engine, sessions and small repository helpers."""

from __future__ import annotations

import json
from datetime import datetime, timezone

import bcrypt
from sqlalchemy import create_engine, event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.store.models import Base, DownloadAttemptRow, EventRow, LlmCacheRow, RequestRow, User


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def make_engine(settings: Settings) -> Engine:
    settings.var_dir.mkdir(parents=True, exist_ok=True)
    settings.spe_dir.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        f"sqlite:///{settings.database_path}",
        connect_args={"check_same_thread": False},
        future=True,
    )

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_connection, _connection_record) -> None:  # type: ignore[no-untyped-def]
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


def init_db(engine: Engine) -> None:
    Base.metadata.create_all(engine)


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False, future=True)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def seed_users(session: Session, settings: Settings) -> None:
    existing = session.scalar(select(User).limit(1))
    if existing is not None:
        return
    session.add_all(
        [
            User(
                username=settings.seed_applicant_username,
                password_hash=hash_password(settings.seed_applicant_password),
                role="applicant",
                display_name="Applicant",
            ),
            User(
                username=settings.seed_staff_username,
                password_hash=hash_password(settings.seed_staff_password),
                role="staff",
                display_name="HDAB staff",
            ),
        ]
    )
    session.commit()


def allocate_request_id(session: Session, preferred: str | None) -> str:
    def taken(value: str) -> bool:
        return session.get(RequestRow, value) is not None

    if preferred and not taken(preferred):
        return preferred
    base = preferred or "req"
    n = 2
    candidate = f"{base}-{n}"
    while taken(candidate):
        n += 1
        candidate = f"{base}-{n}"
    if preferred:
        return candidate
    from uuid import uuid4

    fresh = uuid4().hex[:12]
    while taken(fresh):
        fresh = uuid4().hex[:12]
    return fresh


def add_event(
    session: Session,
    request_id: str,
    step: str,
    status: str,
    duration_ms: int,
    details: dict,
    node: str | None = None,
) -> EventRow:
    row = EventRow(
        request_id=request_id,
        step=step,
        node=node,
        status=status,
        duration_ms=max(0, int(duration_ms)),
        details_json=json.dumps(details, ensure_ascii=False, default=str),
    )
    session.add(row)
    session.commit()
    return row


def get_cache(session: Session, key: str) -> str | None:
    row = session.get(LlmCacheRow, key)
    return row.response_json if row else None


def put_cache(session: Session, key: str, prompt_version: str, model: str, response_json: str) -> None:
    if session.get(LlmCacheRow, key) is not None:
        return
    session.add(
        LlmCacheRow(
            key=key,
            prompt_version=prompt_version,
            model=model,
            response_json=response_json,
        )
    )
    session.commit()


def log_download(session: Session, request_id: str, user_id: int | None, endpoint: str) -> None:
    session.add(DownloadAttemptRow(request_id=request_id, user_id=user_id, endpoint=endpoint))
    session.commit()
