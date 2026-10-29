"""Create one DuckDB file per permit and copy only the cohort's requested records."""

from __future__ import annotations

from pathlib import Path

import duckdb

from app.pipeline.spec import QuerySpec

TABLES = {
    "patients": "patient_id VARCHAR, sex VARCHAR, birth_date DATE, region VARCHAR, data_holder VARCHAR",
    "conditions": "patient_id VARCHAR, icd10 VARCHAR, description VARCHAR, onset_date DATE",
    "medications": "patient_id VARCHAR, atc VARCHAR, name VARCHAR, start_date DATE, end_date DATE",
    "observations": "patient_id VARCHAR, loinc VARCHAR, name VARCHAR, value DECIMAL(18,4), unit VARCHAR, date DATE",
    "encounters": (
        "encounter_id VARCHAR, patient_id VARCHAR, data_holder VARCHAR, type VARCHAR, "
        "start_date DATE, end_date DATE, primary_icd10 VARCHAR"
    ),
}
COLUMNS = {
    "patients": ["patient_id", "sex", "birth_date", "region", "data_holder"],
    "conditions": ["patient_id", "icd10", "description", "onset_date"],
    "medications": ["patient_id", "atc", "name", "start_date", "end_date"],
    "observations": ["patient_id", "loinc", "name", "value", "unit", "date"],
    "encounters": [
        "encounter_id",
        "patient_id",
        "data_holder",
        "type",
        "start_date",
        "end_date",
        "primary_icd10",
    ],
}
CHUNK = 400


def create_spe(
    request_id: str,
    nodes: list,
    cohort_by_node: dict[str, list[str]],
    spec: QuerySpec,
    spe_dir: Path,
) -> dict:
    spe_dir.mkdir(parents=True, exist_ok=True)
    path = spe_dir / f"{_safe_id(request_id)}.duckdb"
    if path.exists():
        path.unlink()
    record_types = [name for name in (spec.spe.record_types if spec.spe else []) if name in TABLES]
    loincs = list(spec.spe.observation_loinc or []) if spec.spe else []
    connection = duckdb.connect(str(path))
    try:
        connection.execute("CREATE TABLE cohort (patient_id VARCHAR)")
        copied: dict[str, dict[str, int]] = {table: {} for table in record_types}
        seen: set[str] = set()
        for node in nodes:
            patient_ids = cohort_by_node.get(node.name, [])
            for patient_id in patient_ids:
                if patient_id not in seen:
                    connection.execute("INSERT INTO cohort VALUES (?)", [patient_id])
                    seen.add(patient_id)
            for table in record_types:
                rows = _fetch(node, table, patient_ids, loincs if table == "observations" else None)
                _ensure(connection, table)
                if rows:
                    _insert(connection, table, rows)
                copied[table][node.name] = len(rows)
        for table in record_types:
            _ensure(connection, table)
    finally:
        connection.close()
    return {
        "cohort_size": len(seen),
        "record_types": record_types,
        "rows": copied,
        "path": str(path),
    }


def _fetch(node, table: str, patient_ids: list[str], loincs: list[str] | None) -> list[dict]:
    if not patient_ids:
        return []
    columns = ", ".join(COLUMNS[table])
    rows: list[dict] = []
    for start in range(0, len(patient_ids), CHUNK):
        chunk = patient_ids[start : start + CHUNK]
        params = {f"id{index}": patient_id for index, patient_id in enumerate(chunk)}
        placeholders = ", ".join(f":id{index}" for index in range(len(chunk)))
        where = f"patient_id IN ({placeholders})"
        if loincs:
            for index, code in enumerate(loincs):
                params[f"loinc{index}"] = code
            where += " AND (" + " OR ".join(f"loinc = :loinc{index}" for index in range(len(loincs))) + ")"
        sql = f"SELECT {columns} FROM {table} WHERE {where}"
        rows.extend(node.fetch_records(sql, params))
    return rows


def _ensure(connection, table: str) -> None:
    connection.execute(f"CREATE TABLE IF NOT EXISTS {table} ({TABLES[table]})")


def _insert(connection, table: str, rows: list[dict]) -> None:
    columns = COLUMNS[table]
    placeholders = ", ".join(["?"] * len(columns))
    payload = [tuple(row.get(column) for column in columns) for row in rows]
    connection.executemany(f"INSERT INTO {table} VALUES ({placeholders})", payload)


def _safe_id(request_id: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in request_id)
    return cleaned or "request"
