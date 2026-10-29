"""Postgres adapter for a real hospital database. Same SQL as the CSV adapter."""

from __future__ import annotations

import socket

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.pool import NullPool


class PostgresHospitalNode:
    def __init__(self, name: str, url: str):
        self.name = name
        self.url = url
        self.engine: Engine = create_engine(
            url,
            pool_pre_ping=True,
            future=True,
            connect_args={"connect_timeout": 3},
        )
        # A new connection every check. A pooled connection would skip the connect
        # timeout and sit forever if the database stops answering mid-session.
        self.probe_engine: Engine = create_engine(
            url,
            poolclass=NullPool,
            future=True,
            connect_args={"connect_timeout": 1},
        )
        event.listen(self.probe_engine, "connect", _bound_probe)

    def run_aggregate(self, sql: str, params: dict) -> list[dict]:
        with self.engine.connect() as connection:
            connection.execute(text("SET statement_timeout = '20s'"))
            result = connection.execute(text(sql), params)
            return [dict(row._mapping) for row in result]

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
        try:
            with self.probe_engine.connect() as connection:
                result = connection.execute(text("SELECT COUNT(*) AS n FROM patients"))
                row = result.mappings().first()
                return int(row["n"]) if row else 0
        except Exception:
            self.probe_engine.dispose()
            raise

    def patient_ids(self) -> set[str]:
        rows = self.fetch_records("SELECT patient_id FROM patients", {})
        return {row["patient_id"] for row in rows}

    def opted_out_count(self) -> int:
        rows = self.run_aggregate("SELECT COUNT(*) AS n FROM patients WHERE opted_out = true", {})
        return int(rows[0]["n"]) if rows else 0

    def ping(self) -> None:
        self.run_aggregate("SELECT 1 AS ok", {})


def _bound_probe(dbapi_connection, _record) -> None:
    """Stop a health check when the port accepts TCP but the database never answers."""
    pgconn = getattr(dbapi_connection, "pgconn", None)
    fd = getattr(pgconn, "socket", None) if pgconn is not None else None
    if not isinstance(fd, int) or fd < 0:
        return
    held = socket.socket(fileno=fd)
    try:
        held.settimeout(3)
    finally:
        held.detach()
