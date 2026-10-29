"""Bind :name parameters for DuckDB. Postgres receives the same SQL through SQLAlchemy."""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Any

_PARAM = re.compile(r":([A-Za-z_][A-Za-z0-9_]*)")


def bind_duckdb(sql: str, params: dict) -> tuple[str, list]:
    values: list = []

    def repl(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in params:
            raise KeyError(f"Missing SQL parameter :{name}")
        values.append(_adapt(params[name]))
        return "?"

    return _PARAM.sub(repl, sql), values


def _adapt(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    return value


def row_dicts(cursor) -> list[dict]:  # type: ignore[no-untyped-def]
    description = cursor.description or []
    columns = [col[0] for col in description]
    out = []
    for row in cursor.fetchall():
        out.append({col: _jsonable(val) for col, val in zip(columns, row)})
    return out


def _jsonable(value: Any) -> Any:
    if isinstance(value, Decimal):
        return value
    return value
