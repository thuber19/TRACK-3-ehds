"""Build the configured hospital nodes and run the startup checks."""

from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

from app.config import Settings
from app.nodes.csv_dev import CsvHospitalNode, load_csv_nodes
from app.nodes.postgres import PostgresHospitalNode

log = logging.getLogger("hdab.nodes")
_probe_lock = threading.Lock()
_probe_cache: dict = {"mono": 0.0, "key": None, "health": None}
_PROBE_TTL_S = 2.0


def build_nodes(settings: Settings) -> list:
    if settings.data_mode == "postgres":
        if not settings.hospital_nodes:
            raise RuntimeError("DATA_MODE=postgres requires HOSPITAL_NODES")
        return [PostgresHospitalNode(name, url) for name, url in settings.hospital_nodes]
    return load_csv_nodes(settings.data_dir)


def startup_checks(nodes: list) -> dict:
    """Reachability and the one-patient-one-node assumption. Patient IDs are not returned."""
    health: list[dict] = []
    warnings: list[str] = []
    id_sets: list[tuple[str, set[str]]] = []
    for node in nodes:
        try:
            if isinstance(node, (CsvHospitalNode, PostgresHospitalNode)):
                ids = node.patient_ids()
            else:
                ids = {row["patient_id"] for row in node.fetch_records("SELECT patient_id FROM patients", {})}
            health.append(
                {"name": node.name, "ok": True, "patients": len(ids), "endpoint": _safe_endpoint(node)}
            )
            id_sets.append((node.name, ids))
        except Exception as exc:  # noqa: BLE001 — startup must report the node, not crash the process
            message = f"{node.name} is not reachable ({exc.__class__.__name__})"
            log.error(message)
            warnings.append(message)
            health.append(
                {"name": node.name, "ok": False, "patients": None, "endpoint": _safe_endpoint(node)}
            )
    overlap = _overlap_count(id_sets)
    if overlap:
        message = (
            f"Patient identity overlap: {overlap} patient IDs appear in more than one hospital node. "
            "Federated totals assume each patient belongs to exactly one node."
        )
        log.warning(message)
        warnings.append(message)
    return {"nodes": health, "warnings": warnings, "overlap_patients": overlap}


def probe_nodes(nodes: list) -> list[dict]:
    """Live reachability. Uses COUNT(*), so a down database is reported without loading patient IDs.

    Concurrent callers share one probe. A fresh result is reused for a couple of seconds,
    so several open screens cannot pile up checks against a database that is not answering.
    """
    if not nodes:
        return []
    key = tuple(getattr(node, "name", "") for node in nodes)
    with _probe_lock:
        now = time.monotonic()
        cached = _probe_cache["health"]
        if (
            cached is not None
            and _probe_cache["key"] == key
            and now - _probe_cache["mono"] < _PROBE_TTL_S
        ):
            return cached
        health = _probe_uncached(nodes)
        _probe_cache["mono"] = time.monotonic()
        _probe_cache["key"] = key
        _probe_cache["health"] = health
        return health


def _probe_uncached(nodes: list) -> list[dict]:
    with ThreadPoolExecutor(max_workers=len(nodes)) as pool:
        return list(pool.map(_probe_one, nodes))


def _probe_one(node) -> dict:
    try:
        patients = int(node.patient_count())
        return {"name": node.name, "ok": True, "patients": patients, "endpoint": _safe_endpoint(node)}
    except Exception as exc:  # noqa: BLE001 — one down node must not hide the others
        log.error("%s is not reachable (%s)", node.name, exc.__class__.__name__)
        return {"name": node.name, "ok": False, "patients": None, "endpoint": _safe_endpoint(node)}


def live_warnings(startup: dict, node_health: list[dict]) -> list[str]:
    warnings = [
        item for item in startup.get("warnings", []) if str(item).startswith("Patient identity overlap")
    ]
    for item in node_health:
        if not item.get("ok"):
            warnings.append(f"{item['name']} is not reachable")
    return warnings


def wait_for_nodes(nodes: list, timeout_s: float = 120) -> dict:
    deadline = time.monotonic() + timeout_s
    checks = startup_checks(nodes)
    while time.monotonic() < deadline and any(not item.get("ok") for item in checks["nodes"]):
        time.sleep(2)
        checks = startup_checks(nodes)
    return checks


def _safe_endpoint(node) -> str:
    url = getattr(node, "url", "") or ""
    if not url:
        return "CSV files"
    parsed = urlparse(url)
    host = parsed.hostname or "postgres"
    port = f":{parsed.port}" if parsed.port else ""
    database = parsed.path.lstrip("/") or "hospital"
    return f"{host}{port}/{database}"


def _overlap_count(id_sets: list[tuple[str, set[str]]]) -> int:
    seen: dict[str, int] = {}
    for _name, ids in id_sets:
        for patient_id in ids:
            seen[patient_id] = seen.get(patient_id, 0) + 1
    return sum(1 for count in seen.values() if count > 1)
