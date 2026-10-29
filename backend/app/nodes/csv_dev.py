"""Dev adapter: one DuckDB database per hospital, split from the synthetic CSVs by data_holder."""

from __future__ import annotations

import threading
from pathlib import Path

import duckdb

from app.nodes.sqlutil import bind_duckdb, row_dicts

PREFERRED_ORDER = ["Klinikum Nord", "Klinikum Süd", "Klinikum West"]

_CACHE: dict[str, list["CsvHospitalNode"]] = {}


class CsvHospitalNode:
    def __init__(self, name: str, connection: duckdb.DuckDBPyConnection):
        self.name = name
        self._con = connection
        self._lock = threading.Lock()

    def run_aggregate(self, sql: str, params: dict) -> list[dict]:
        bound, values = bind_duckdb(sql, params)
        with self._lock:
            cursor = self._con.execute(bound, values)
            return row_dicts(cursor)

    def fetch_records(self, sql: str, params: dict) -> list[dict]:
        return self.run_aggregate(sql, params)

    def code_catalog(self) -> dict:
        icd = self.run_aggregate(
            """
            SELECT code, MIN(description) AS description FROM (
                SELECT icd10 AS code, description FROM conditions
                UNION ALL
                SELECT primary_icd10 AS code, '' AS description
                FROM encounters
                WHERE primary_icd10 IS NOT NULL AND primary_icd10 <> ''
            ) codes
            WHERE code IS NOT NULL AND code <> ''
            GROUP BY code
            ORDER BY code
            """,
            {},
        )
        atc = self.run_aggregate(
            """
            SELECT atc AS code, MIN(name) AS description
            FROM medications
            WHERE atc IS NOT NULL AND atc <> ''
            GROUP BY atc
            ORDER BY atc
            """,
            {},
        )
        loinc = self.run_aggregate(
            """
            SELECT loinc AS code, MIN(name) AS description
            FROM observations
            WHERE loinc IS NOT NULL AND loinc <> ''
            GROUP BY loinc
            ORDER BY loinc
            """,
            {},
        )
        return {"icd10": icd, "atc": atc, "loinc": loinc}

    def patient_count(self) -> int:
        rows = self.run_aggregate("SELECT COUNT(*) AS n FROM patients", {})
        return int(rows[0]["n"]) if rows else 0

    def patient_ids(self) -> set[str]:
        rows = self.fetch_records("SELECT patient_id FROM patients", {})
        return {row["patient_id"] for row in rows}

    def opted_out_count(self) -> int:
        rows = self.run_aggregate("SELECT COUNT(*) AS n FROM patients WHERE opted_out = true", {})
        return int(rows[0]["n"]) if rows else 0


def load_csv_nodes(data_dir: Path) -> list[CsvHospitalNode]:
    key = str(data_dir.resolve())
    cached = _CACHE.get(key)
    if cached is not None:
        return cached
    nodes = _build(data_dir)
    _CACHE[key] = nodes
    return nodes


def _build(data_dir: Path) -> list[CsvHospitalNode]:
    patients = _sql_path(data_dir / "patients.csv")
    probe = duckdb.connect()
    holders = [
        row[0]
        for row in probe.execute(
            f"SELECT DISTINCT data_holder FROM read_csv_auto('{patients}', header=true)"
        ).fetchall()
    ]
    probe.close()
    ordered = [name for name in PREFERRED_ORDER if name in holders]
    ordered += sorted(name for name in holders if name not in ordered)
    return [CsvHospitalNode(holder, _load_holder(data_dir, holder)) for holder in ordered]


def _load_holder(data_dir: Path, holder: str) -> duckdb.DuckDBPyConnection:
    patients = _sql_path(data_dir / "patients.csv")
    conditions = _sql_path(data_dir / "conditions.csv")
    medications = _sql_path(data_dir / "medications.csv")
    observations = _sql_path(data_dir / "observations.csv")
    encounters = _sql_path(data_dir / "encounters.csv")
    # The holder name is one of the values in the CSV, interpolated as a SQL literal
    # after escaping quotes. It is not taken from an applicant request.
    literal = holder.replace("'", "''")
    connection = duckdb.connect()
    connection.execute(
        f"""
        CREATE TABLE patients AS
        SELECT
            patient_id,
            sex,
            CAST(birth_date AS DATE) AS birth_date,
            region,
            data_holder,
            CASE
                WHEN lower(CAST(opted_out AS VARCHAR)) IN ('true', 't', '1') THEN TRUE
                ELSE FALSE
            END AS opted_out
        FROM read_csv_auto('{patients}', header=true)
        WHERE data_holder = '{literal}';

        CREATE TABLE conditions AS
        SELECT patient_id, icd10, description, CAST(onset_date AS DATE) AS onset_date
        FROM read_csv_auto('{conditions}', header=true)
        WHERE patient_id IN (SELECT patient_id FROM patients);

        CREATE TABLE medications AS
        SELECT
            patient_id,
            atc,
            name,
            CAST(start_date AS DATE) AS start_date,
            CASE
                WHEN end_date IS NULL OR CAST(end_date AS VARCHAR) = '' THEN NULL
                ELSE CAST(end_date AS DATE)
            END AS end_date
        FROM read_csv_auto('{medications}', header=true)
        WHERE patient_id IN (SELECT patient_id FROM patients);

        CREATE TABLE observations AS
        SELECT
            patient_id,
            loinc,
            name,
            CAST(value AS DECIMAL(18, 4)) AS value,
            unit,
            CAST(date AS DATE) AS date
        FROM read_csv_auto('{observations}', header=true)
        WHERE patient_id IN (SELECT patient_id FROM patients);

        CREATE TABLE encounters AS
        SELECT
            encounter_id,
            patient_id,
            data_holder,
            type,
            CAST(start_date AS DATE) AS start_date,
            CAST(end_date AS DATE) AS end_date,
            NULLIF(primary_icd10, '') AS primary_icd10
        FROM read_csv_auto('{encounters}', header=true)
        WHERE patient_id IN (SELECT patient_id FROM patients);
        """
    )
    return connection


def _sql_path(path: Path) -> str:
    return str(path).replace("'", "''")
