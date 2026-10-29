"""Hospital node interface. Table and column names stay in the adapters and the compiler."""

from __future__ import annotations

from typing import Protocol


class HospitalNode(Protocol):
    name: str

    def run_aggregate(self, sql: str, params: dict) -> list[dict]:
        """Run an aggregate query. Returns rows of partial aggregates, never a patient extract."""

    def fetch_records(self, sql: str, params: dict) -> list[dict]:
        """Read rows for an SPE copy. Callers must not return these rows to applicants."""

    def code_catalog(self) -> dict:
        """Distinct codes and descriptions. No patient identifiers."""
