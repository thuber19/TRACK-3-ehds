"""Session login for the demo. Not production authentication."""

from __future__ import annotations

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.store.db import verify_password
from app.store.models import User


def authenticate(session: Session, username: str, password: str) -> User | None:
    user = session.scalar(select(User).where(User.username == username))
    if user is None or not verify_password(password, user.password_hash):
        return None
    return user


def current_user(request: Request, session: Session) -> User | None:
    user_id = request.session.get("user_id")
    if not user_id:
        return None
    return session.get(User, int(user_id))


def require_user(request: Request, session: Session) -> User:
    user = current_user(request, session)
    if user is None:
        raise HTTPException(status_code=401, detail="Login required")
    return user


def require_role(request: Request, session: Session, *roles: str) -> User:
    user = require_user(request, session)
    if user.role not in roles:
        raise HTTPException(status_code=403, detail="This action is not available for your role")
    return user
