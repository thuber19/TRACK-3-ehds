"""Run the access-body steps and write one log event per step."""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.config import Settings
from app.pipeline.compiler import compile_aggregate, compile_cohort
from app.pipeline.decision import decide
from app.pipeline.federation import NodeFailure, execute, merge_partials
from app.pipeline.llm import purpose_from_model, spec_from_model
from app.pipeline.privacy import PrivacyError, privacy_guard
from app.pipeline.smallcell import apply_small_cell
from app.pipeline.spec import DataRequestIn, QuerySpec
from app.pipeline.spe import create_spe
from app.pipeline.terminology import Catalog, collect_code_uses
from app.store.db import add_event, allocate_request_id, get_cache, put_cache
from app.store.models import RequestRow, User

log = logging.getLogger("hdab.pipeline")
INCOMPLETE = "The request could not be completed."


def run_pipeline(
    raw: dict,
    user: User,
    settings: Settings,
    session: Session,
    nodes: list,
    catalog: Catalog,
) -> RequestRow:
    started = time.perf_counter()
    request = DataRequestIn.model_validate(raw)
    request_id = allocate_request_id(session, request.id)
    row = RequestRow(
        id=request_id,
        submitted_by=user.id,
        raw_json=json.dumps(raw, ensure_ascii=False),
        status="PROCESSING",
    )
    session.add(row)
    session.commit()

    def event(step: str, status: str, details: dict, duration_ms: int = 0, node: str | None = None) -> None:
        add_event(session, request_id, step, status, duration_ms, details, node=node)

    try:
        _run(raw, request, row, settings, session, nodes, catalog, event, started)
    except Exception as exc:  # noqa: BLE001 — the applicant gets a completion error, staff get the event
        log.exception("Pipeline failed for %s", request_id)
        row.status = "ERROR"
        row.reason = INCOMPLETE
        row.answer_json = None
        event("pipeline", "error", {"error": exc.__class__.__name__})
        _finish(row, started)
        session.commit()
    return row


def _run(raw, request, row, settings, session, nodes, catalog, event, started) -> None:
    step_started = time.perf_counter()
    event(
        "validate",
        "ok",
        {
            "applicant": request.applicant_name(),
            "organisation": request.organisation(),
            "requested_as": request.requested_as,
            "definition_count": len(request.definitions),
        },
        _ms(step_started),
    )

    step_started = time.perf_counter()
    assessment = _purpose_model(settings, request, session, event)
    if assessment is None:
        event("purpose_check", "error", {"model_required": not bool(settings.openai_api_key)}, _ms(step_started))
        _fail(row, started, session)
        return
    event(
        "purpose_check",
        "ok",
        {
            "prohibited": assessment.prohibited,
            "prohibited_category": assessment.prohibited_category,
            "allowed_purposes": assessment.allowed_purposes,
            "evidence": assessment.evidence,
            "justifies_patient_level": assessment.justifies_patient_level,
            "justification_evidence": assessment.justification_evidence,
            "source": assessment.source,
        },
        _ms(step_started),
    )

    step_started = time.perf_counter()
    decision = decide(request, assessment)
    row.decision = decision.decision
    row.articles_json = json.dumps(decision.articles)
    row.reason = decision.reason
    event(
        "decision",
        "ok",
        {"branch": decision.branch, "decision": decision.decision, "articles": decision.articles},
        _ms(step_started),
    )
    if decision.decision == "REJECT":
        row.status = "DONE"
        row.answer_json = None
        _finish(row, started)
        session.commit()
        return

    step_started = time.perf_counter()
    spec = _model_spec(settings, request, catalog, session, event)
    if spec is None:
        event("interpret", "error", {"model_required": not bool(settings.openai_api_key)}, _ms(step_started))
        _fail(row, started, session)
        return
    row.spec_json = spec.model_dump_json()
    event("interpret", "ok", {"spec": json.loads(row.spec_json), "source": "model"}, _ms(step_started))

    step_started = time.perf_counter()
    mapped, unknown_codes = _map_codes(spec, catalog)
    event(
        "code_mapping",
        "warn" if unknown_codes else "ok",
        {"mapped": mapped, "unknown": unknown_codes},
        _ms(step_started),
    )

    if decision.decision == "APPROVE_SPE":
        _run_spe(row, spec, nodes, settings, event, started, session)
        return

    _run_statistics(row, spec, nodes, settings, event, started, session)


def _run_statistics(row, spec: QuerySpec, nodes, settings: Settings, event, started, session: Session) -> None:
    compiled = compile_aggregate(spec)
    step_started = time.perf_counter()
    try:
        runs = execute(nodes, compiled, settings.node_timeout_s)
    except NodeFailure as exc:
        _log_node_runs(event, compiled.sql, getattr(exc, "runs", []), failed=True, nodes=nodes)
        _fail(row, started, session)
        return
    _log_node_runs(event, compiled.sql, runs, failed=False, nodes=nodes)
    merged = merge_partials({run.name: run.rows or [] for run in runs}, compiled)
    event("merge", "ok", {"nodes": len(runs), "group_rows": len(merged)}, _ms(step_started))
    step_started = time.perf_counter()
    answer, suppressed, any_suppressed = apply_small_cell(spec, merged, [node.name for node in nodes])
    event("small_cell", "ok", {"suppressed": suppressed}, _ms(step_started))
    if any_suppressed and row.reason and "Small cells are suppressed." not in row.reason:
        row.reason = row.reason.rstrip() + " Small cells are suppressed."
    try:
        privacy_guard(answer)
    except PrivacyError as exc:
        event("small_cell", "error", {"privacy": str(exc)})
        _fail(row, started, session)
        return
    row.answer_json = json.dumps(answer, ensure_ascii=False)
    row.status = "DONE"
    _finish(row, started)
    session.commit()


def _run_spe(row, spec: QuerySpec, nodes, settings: Settings, event, started, session: Session) -> None:
    if spec.spe is None:
        event("spe", "error", {"error": "No secure-processing specification"})
        _fail(row, started, session)
        return
    compiled = compile_cohort(spec)
    try:
        runs = execute(nodes, compiled, settings.node_timeout_s, records=True)
    except NodeFailure as exc:
        _log_node_runs(event, compiled.sql, getattr(exc, "runs", []), failed=True, nodes=nodes)
        _fail(row, started, session)
        return
    _log_node_runs(event, compiled.sql, runs, failed=False, nodes=nodes)
    cohort = {run.name: [item["patient_id"] for item in (run.rows or [])] for run in runs}
    step_started = time.perf_counter()
    created = create_spe(row.id, nodes, cohort, spec, settings.spe_dir)
    event(
        "spe",
        "ok",
        {
            "cohort_size": created["cohort_size"],
            "record_types": created["record_types"],
            "rows": created["rows"],
        },
        _ms(step_started),
    )
    answer = {"cohort_size": created["cohort_size"]}
    try:
        privacy_guard(answer)
    except PrivacyError as exc:
        event("spe", "error", {"privacy": str(exc)})
        _fail(row, started, session)
        return
    row.answer_json = json.dumps(answer)
    row.status = "DONE"
    _finish(row, started)
    session.commit()


def _log_node_runs(event, sql: str, runs, failed: bool, nodes=None) -> None:
    excluded = _opted_out_counts(nodes)
    logged = {run.name for run in runs}
    for run in runs:
        event(
            "query",
            "error" if run.error else "ok",
            {
                "opted_out_excluded": excluded.get(run.name, 0),
                "sql": sql,
                "error": run.error,
            },
            run.duration_ms,
            node=run.name,
        )
    if failed and not logged:
        event("query", "error", {"opted_out_excluded": 0, "sql": sql, "error": "node failed"})


def _opted_out_counts(nodes) -> dict[str, int]:
    counts: dict[str, int] = {}
    for node in nodes or []:
        try:
            counts[node.name] = int(node.opted_out_count())
        except Exception:  # noqa: BLE001 — the count is informational
            counts[node.name] = 0
    return counts


def _fail(row: RequestRow, started: float, session: Session) -> None:
    row.status = "ERROR"
    row.reason = INCOMPLETE
    row.answer_json = None
    _finish(row, started)
    session.commit()


def _finish(row: RequestRow, started: float) -> None:
    row.finished_at = datetime.now(timezone.utc)
    row.duration_ms = _ms_since(started)


def _purpose_model(settings, request, session, event):
    if not settings.openai_api_key:
        return None
    try:
        return purpose_from_model(settings, request, lambda key: get_cache(session, key), lambda *args: put_cache(session, *args))
    except Exception as exc:  # noqa: BLE001 — there is no phrase-list fallback
        log.warning("Purpose model failed: %s", exc)
        event("purpose_check", "warn", {"llm_error": exc.__class__.__name__})
        return None


def _model_spec(settings, request, catalog, session, event) -> QuerySpec | None:
    if not settings.openai_api_key:
        return None
    error = None
    for _attempt in range(2):
        try:
            proposed = spec_from_model(
                settings,
                request,
                catalog,
                lambda key: get_cache(session, key),
                lambda *args: put_cache(session, *args),
                validation_error=error,
            )
        except Exception as exc:  # noqa: BLE001
            event("interpret", "warn", {"llm_error": exc.__class__.__name__})
            return None
        if proposed is None:
            return None
        try:
            return QuerySpec.model_validate(proposed.model_dump())
        except ValidationError as exc:
            error = str(exc)
    event("interpret", "warn", {"llm_error": "spec validation failed"})
    return None


def _map_codes(spec: QuerySpec, catalog: Catalog) -> tuple[list[dict], list[dict]]:
    mapped = []
    unknown = []
    seen = set()
    for kind, prefix in collect_code_uses(spec):
        key = (kind, prefix)
        if key in seen:
            continue
        seen.add(key)
        matches = catalog.matching_codes(kind, prefix)
        entry = {"kind": kind, "prefix": prefix, "matches": matches}
        if matches:
            mapped.append(entry)
        else:
            unknown.append(entry)
    return mapped, unknown


def _ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


def _ms_since(started: float) -> int:
    return _ms(started)
