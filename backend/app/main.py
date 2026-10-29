"""FastAPI application: the access-body API and, when built, the web UI."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.middleware.sessions import SessionMiddleware

from app.auth import authenticate, require_role, require_user
from app.config import Settings
from app.nodes.factory import build_nodes, live_warnings, probe_nodes, startup_checks, wait_for_nodes
from app.pipeline.orchestrator import run_pipeline
from app.pipeline.privacy import PrivacyError, privacy_guard
from app.pipeline.terminology import merge_catalogs
from app.store.db import add_event, init_db, log_download, make_engine, make_session_factory, seed_users
from app.store.models import DownloadAttemptRow, EventRow, RequestRow, User

log = logging.getLogger("hdab")
DOWNLOAD_BLOCKED = "Data cannot leave the secure processing environment (Art. 73)."


class LoginBody(BaseModel):
    username: str
    password: str


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    logging.basicConfig(level=logging.INFO)
    engine = make_engine(settings)
    init_db(engine)
    session_factory = make_session_factory(engine)
    with session_factory() as session:
        seed_users(session, settings)

    nodes = build_nodes(settings)
    checks = wait_for_nodes(nodes) if settings.data_mode == "postgres" else startup_checks(nodes)
    reachable = [node for node, health in zip(nodes, checks["nodes"]) if health.get("ok")]
    catalog = merge_catalogs(reachable) if reachable else merge_catalogs([])

    app = FastAPI(title="Health Data Access Body", docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.session_secret,
        session_cookie="hdab_session",
        max_age=60 * 60 * 24 * 14,
        same_site="lax",
        https_only=False,
    )
    origins = [
        item.strip()
        for item in os.environ.get("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
        if item.strip()
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.settings = settings
    app.state.session_factory = session_factory
    app.state.nodes = nodes
    app.state.checks = checks
    app.state.catalog = catalog

    def get_db():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    @app.get("/api/health")
    def health():
        node_health = probe_nodes(app.state.nodes)
        warnings = live_warnings(app.state.checks, node_health)
        degraded = any(not item.get("ok") for item in node_health) or bool(warnings)
        return JSONResponse(
            {
                "status": "degraded" if degraded else "ok",
                "data_mode": settings.data_mode,
                "nodes": node_health,
                "warnings": warnings,
            },
            headers={"Cache-Control": "no-store"},
        )

    @app.post("/api/auth/login")
    def login(body: LoginBody, request: Request, db: Session = Depends(get_db)):
        user = authenticate(db, body.username.strip(), body.password)
        if user is None:
            raise HTTPException(status_code=401, detail="Unknown username or password")
        request.session["user_id"] = user.id
        return _user_payload(user)

    @app.post("/api/auth/logout")
    def logout(request: Request):
        request.session.clear()
        return {"ok": True}

    @app.get("/api/auth/me")
    def me(request: Request, db: Session = Depends(get_db)):
        user = require_user(request, db)
        return _user_payload(user)

    @app.get("/api/examples")
    def examples(request: Request, db: Session = Depends(get_db)):
        require_user(request, db)
        payloads = []
        for path in sorted(settings.requests_dir.glob("R*.json")):
            payloads.append(json.loads(path.read_text(encoding="utf-8")))
        return payloads

    @app.post("/api/requests")
    def submit(payload: dict, request: Request, db: Session = Depends(get_db)):
        user = require_role(request, db, "applicant")
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="The request must be a JSON object")
        row = run_pipeline(payload, user, settings, db, app.state.nodes, app.state.catalog)
        return _serialize(row, user, db, detail=True)

    @app.get("/api/requests")
    def list_requests(request: Request, db: Session = Depends(get_db)):
        user = require_user(request, db)
        query = select(RequestRow).order_by(RequestRow.created_at.desc())
        if user.role != "staff":
            query = query.where(RequestRow.submitted_by == user.id)
        rows = db.scalars(query).all()
        return [_serialize(row, user, db, detail=False) for row in rows]

    @app.get("/api/requests/{request_id}")
    def get_request(request_id: str, request: Request, db: Session = Depends(get_db)):
        user = require_user(request, db)
        row = _load_visible(db, user, request_id)
        return _serialize(row, user, db, detail=True)

    @app.post("/api/spe/{request_id}/download")
    def download_spe(request_id: str, request: Request, db: Session = Depends(get_db)):
        _block_export(request, db, request_id, "POST /api/spe/{id}/download")
        raise HTTPException(status_code=403, detail=DOWNLOAD_BLOCKED)

    @app.get("/api/spe/{request_id}/export")
    def export_spe(request_id: str, request: Request, db: Session = Depends(get_db)):
        _block_export(request, db, request_id, "GET /api/spe/{id}/export")
        raise HTTPException(status_code=403, detail=DOWNLOAD_BLOCKED)

    def _block_export(request: Request, db: Session, request_id: str, endpoint: str) -> None:
        user = None
        try:
            user = require_user(request, db)
        except HTTPException:
            user = None
        row = db.get(RequestRow, request_id)
        if row is not None:
            log_download(db, request_id, user.id if user else None, endpoint)
            add_event(
                db,
                request_id,
                "download",
                "error",
                0,
                {"endpoint": endpoint, "blocked": True, "user": user.username if user else None},
            )
        # The response is always 403. Raising happens in the route so the log is committed first.

    if settings.frontend_dist.is_dir():
        _mount_frontend(app, settings.frontend_dist)

    return app


def _mount_frontend(app: FastAPI, dist: Path) -> None:
    @app.get("/")
    def index():
        return FileResponse(dist / "index.html")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        if full_path.startswith("api"):
            raise HTTPException(status_code=404, detail="Not found")
        candidate = (dist / full_path).resolve()
        if not str(candidate).startswith(str(dist.resolve())):
            raise HTTPException(status_code=404, detail="Not found")
        if candidate.is_file():
            return FileResponse(candidate)
        index = dist / "index.html"
        if index.is_file():
            return FileResponse(index)
        raise HTTPException(status_code=404, detail="Not found")


def _user_payload(user: User) -> dict:
    return {"id": user.id, "username": user.username, "role": user.role, "display_name": user.display_name}


def _load_visible(db: Session, user: User, request_id: str) -> RequestRow:
    row = db.get(RequestRow, request_id)
    if row is None or (user.role != "staff" and row.submitted_by != user.id):
        raise HTTPException(status_code=404, detail="Request not found")
    return row


def _serialize(row: RequestRow, user: User, db: Session, *, detail: bool) -> dict:
    raw = json.loads(row.raw_json)
    applicant = raw.get("applicant") or {}
    answer = json.loads(row.answer_json) if row.answer_json else None
    spe = None
    if row.decision == "APPROVE_SPE" and row.spec_json:
        spec = json.loads(row.spec_json)
        spe_spec = spec.get("spe") or {}
        spe = {
            "id": row.id,
            "record_types": spe_spec.get("record_types") or [],
            "observation_loinc": spe_spec.get("observation_loinc") or [],
        }
    body = {
        "id": row.id,
        "status": row.status,
        "decision": row.decision,
        "articles": json.loads(row.articles_json) if row.articles_json else [],
        "reason": row.reason,
        "answer": answer,
        "duration_ms": row.duration_ms,
        "created_at": _iso(row.created_at),
        "finished_at": _iso(row.finished_at),
        "summary": {
            "source_id": raw.get("id"),
            "applicant": applicant.get("name"),
            "organisation": applicant.get("organisation"),
            "country": applicant.get("country"),
            "purpose": raw.get("purpose"),
            "question": raw.get("question"),
            "requested_as": raw.get("requested_as"),
            "requested_format": raw.get("requested_format"),
            "definitions": raw.get("definitions") or [],
            "submitted": raw.get("submitted"),
        },
        "spe": spe,
        "federation": _federation(db, row) if detail else None,
    }
    if user.role != "staff":
        try:
            privacy_guard(answer)
        except PrivacyError as exc:
            raise HTTPException(status_code=500, detail="Response blocked by the privacy guard") from exc
        return body
    if detail:
        events = db.scalars(select(EventRow).where(EventRow.request_id == row.id).order_by(EventRow.id)).all()
        attempts = db.scalars(
            select(DownloadAttemptRow).where(DownloadAttemptRow.request_id == row.id).order_by(DownloadAttemptRow.id)
        ).all()
        body["raw"] = raw
        body["events"] = [
            {
                "id": item.id,
                "ts": _iso(item.ts),
                "step": item.step,
                "node": item.node,
                "status": item.status,
                "duration_ms": item.duration_ms,
                "details": json.loads(item.details_json or "{}"),
            }
            for item in events
        ]
        body["spec"] = json.loads(row.spec_json) if row.spec_json else None
        body["download_attempts"] = [
            {"id": item.id, "user_id": item.user_id, "ts": _iso(item.ts), "endpoint": item.endpoint}
            for item in attempts
        ]
    return body


def _federation(db: Session, row: RequestRow) -> dict | None:
    events = db.scalars(select(EventRow).where(EventRow.request_id == row.id, EventRow.step == "query")).all()
    hospitals = []
    for item in events:
        if not item.node:
            continue
        try:
            error = str(json.loads(item.details_json or "{}").get("error") or "")
        except json.JSONDecodeError:
            error = ""
        if item.status == "ok":
            status = "ok"
        elif "timeout" in error.lower():
            status = "timeout"
        else:
            status = "failed"
        hospitals.append({"name": item.node, "status": status})
    if not hospitals:
        return None
    failed = any(item["status"] != "ok" for item in hospitals) or row.status == "ERROR"
    return {"status": "failed" if failed else "complete", "hospitals": hospitals}


def _iso(value) -> str | None:
    if value is None:
        return None
    return value.isoformat()


app = create_app()
