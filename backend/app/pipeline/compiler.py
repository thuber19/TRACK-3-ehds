"""Compile a QuerySpec into portable SQL (DuckDB and Postgres).

LLM text never reaches the SQL string. Only whitelisted columns and bound parameters do.
Every query starts from patients who have not opted out.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.pipeline.spec import Filter, QuerySpec

_MAX_PREFIX = 16


@dataclass
class CompiledQuery:
    sql: str
    params: dict
    count_metrics: list[str] = field(default_factory=list)
    mean_metrics: list[str] = field(default_factory=list)
    group_count: int = 0


class ParamBag:
    def __init__(self) -> None:
        self.values: dict[str, object] = {}

    def add(self, value: object) -> str:
        name = f"p{len(self.values)}"
        self.values[name] = value
        return f":{name}"


def compile_aggregate(spec: QuerySpec) -> CompiledQuery:
    params = ParamBag()
    count_metrics = [metric.name for metric in spec.metrics if metric.type == "count"]
    mean_metrics = [metric for metric in spec.metrics if metric.type == "mean"]
    loincs: list[str] = []
    for metric in mean_metrics:
        if metric.value and metric.value.loinc not in loincs:
            loincs.append(metric.value.loinc)
    age_sql = _age_expr("src", params, spec.reference_date)
    group_sql, group_count = _group_select(spec, params, alias="p")
    where_groups = " AND ".join(f"g{i} IS NOT NULL" for i in range(group_count)) or "TRUE"
    agg_sql = _aggregates(spec, params, alias="p", count_metrics=count_metrics, mean_metrics=mean_metrics)
    obs_cols, joins = _obs_select(mean_metrics, params)
    base_sql = _render_filter(spec.base, params, patient="p", encounter="e")

    ctes = [
        "eligible AS (\n    SELECT * FROM patients WHERE opted_out = false\n)",
        f"aged AS (\n    SELECT src.*, {age_sql} AS age\n    FROM eligible src\n)",
    ]
    if spec.unit == "encounter":
        ctes.append(
            "enc AS (\n"
            "    SELECT e.encounter_id, e.patient_id, e.type, e.start_date, e.end_date, e.primary_icd10,\n"
            "           p.region, p.sex, p.data_holder, p.age, p.birth_date\n"
            "    FROM encounters e\n"
            "    JOIN aged p ON p.patient_id = e.patient_id\n"
            f"    WHERE {base_sql}\n"
            ")"
        )
        source = "enc"
    else:
        ctes.append(f"base_pop AS (\n    SELECT * FROM aged p\n    WHERE {base_sql}\n)")
        source = "base_pop"
    if loincs:
        ctes.append(_latest_cte(loincs, params))
    extra = f"{obs_cols}, " if obs_cols else ""
    ctes.append(
        "grouped_src AS (\n"
        f"    SELECT p.*, {extra}{group_sql}\n"
        f"    FROM {source} p\n"
        f"    {joins}\n"
        ")"
    )
    group_cols = ", ".join(f"g{i}" for i in range(group_count))
    select_list = f"{group_cols}, {agg_sql}" if group_cols else agg_sql
    group_by = (
        "GROUP BY " + ", ".join(str(i + 1) for i in range(group_count)) if group_count else ""
    )
    sql = "WITH " + ",\n".join(ctes) + f"\nSELECT {select_list}\nFROM grouped_src p\nWHERE {where_groups}\n{group_by}"
    return CompiledQuery(
        sql=_tidy(sql),
        params=params.values,
        count_metrics=count_metrics,
        mean_metrics=[metric.name for metric in mean_metrics],
        group_count=group_count,
    )


def compile_cohort(spec: QuerySpec) -> CompiledQuery:
    params = ParamBag()
    age_sql = _age_expr("src", params, spec.reference_date)
    base_sql = _render_filter(spec.base, params, patient="p", encounter="e")
    if spec.unit == "encounter":
        body = f"""
WITH eligible AS (
    SELECT * FROM patients WHERE opted_out = false
),
aged AS (
    SELECT src.*, {age_sql} AS age
    FROM eligible src
)
SELECT DISTINCT p.patient_id AS patient_id
FROM encounters e
JOIN aged p ON p.patient_id = e.patient_id
WHERE {base_sql}
""".strip()
    else:
        body = f"""
WITH eligible AS (
    SELECT * FROM patients WHERE opted_out = false
),
aged AS (
    SELECT src.*, {age_sql} AS age
    FROM eligible src
)
SELECT p.patient_id AS patient_id
FROM aged p
WHERE {base_sql}
""".strip()
    return CompiledQuery(sql=_tidy(body), params=params.values)


def _tidy(sql: str) -> str:
    lines = [line.rstrip() for line in sql.splitlines()]
    cleaned = "\n".join(lines)
    while "\n\n\n" in cleaned:
        cleaned = cleaned.replace("\n\n\n", "\n\n")
    return cleaned.strip()


def _age_expr(alias: str, params: ParamBag, reference_date: str) -> str:
    ref = params.add(reference_date)
    ref_date = f"CAST({ref} AS DATE)"
    return (
        f"CAST("
        f"EXTRACT(YEAR FROM {ref_date}) - EXTRACT(YEAR FROM {alias}.birth_date)"
        f" - CASE"
        f" WHEN EXTRACT(MONTH FROM {ref_date}) < EXTRACT(MONTH FROM {alias}.birth_date)"
        f" OR (EXTRACT(MONTH FROM {ref_date}) = EXTRACT(MONTH FROM {alias}.birth_date)"
        f" AND EXTRACT(DAY FROM {ref_date}) < EXTRACT(DAY FROM {alias}.birth_date))"
        f" THEN 1 ELSE 0 END"
        f" AS INTEGER)"
    )


def _group_select(spec: QuerySpec, params: ParamBag, alias: str) -> tuple[str, int]:
    parts: list[str] = []
    for index, group in enumerate(spec.groups):
        if group.dimension == "age_band":
            clauses = []
            for band in group.bands or []:
                label = params.add(band.label)
                lower = params.add(int(band.min))
                if band.max is None:
                    clauses.append(f"WHEN {alias}.age >= {lower} THEN {label}")
                else:
                    upper = params.add(int(band.max))
                    clauses.append(f"WHEN {alias}.age >= {lower} AND {alias}.age <= {upper} THEN {label}")
            expr = "CASE " + " ".join(clauses) + " ELSE NULL END"
        elif group.dimension == "region":
            expr = f"{alias}.region"
        elif group.dimension == "sex":
            expr = f"{alias}.sex"
        elif group.dimension == "data_holder":
            expr = f"{alias}.data_holder"
        else:
            raise ValueError(f"Unsupported group dimension {group.dimension}")
        parts.append(f"{expr} AS g{index}")
    if not parts:
        return "1 AS _keep", 0
    return ", ".join(parts), len(parts)


def _aggregates(spec, params, alias, count_metrics, mean_metrics) -> str:
    pieces: list[str] = []
    count_by_name = {metric.name: metric for metric in spec.metrics if metric.type == "count"}
    for index, name in enumerate(count_metrics):
        metric = count_by_name[name]
        pred = _render_filter(metric.filter or Filter(op="true"), params, patient=alias, encounter=alias)
        if spec.unit == "encounter":
            pieces.append(f"COUNT(*) FILTER (WHERE {pred}) AS c{index}")
        else:
            pieces.append(f"COUNT(*) FILTER (WHERE {pred}) AS c{index}")
    for index, metric in enumerate(mean_metrics):
        pred = _render_filter(metric.filter or Filter(op="true"), params, patient=alias, encounter=alias)
        loinc_alias = _loinc_key(metric.value.loinc if metric.value else "")
        value_expr = f"p.{loinc_alias}_value"
        pieces.append(f"SUM(CASE WHEN {pred} THEN {value_expr} ELSE NULL END) AS s{index}")
        pieces.append(f"COUNT({value_expr}) FILTER (WHERE {pred}) AS n{index}")
    if not pieces:
        pieces.append("COUNT(*) AS c0")
    return ", ".join(pieces)


def _obs_select(mean_metrics, params: ParamBag) -> tuple[str, str]:
    joins = []
    columns = []
    seen = set()
    for metric in mean_metrics:
        if not metric.value:
            continue
        loinc = metric.value.loinc
        if loinc in seen:
            continue
        seen.add(loinc)
        token = params.add(loinc)
        key = _loinc_key(loinc)
        joins.append(
            f"LEFT JOIN latest_obs {key} ON {key}.patient_id = p.patient_id "
            f"AND {key}.rn = 1 AND {key}.loinc = {token}"
        )
        columns.append(f"{key}.value AS {key}_value")
    return ", ".join(columns), "\n".join(joins)


def _latest_cte(loincs: list[str], params: ParamBag) -> str:
    if not loincs:
        return ""
    placeholders = ", ".join(params.add(code) for code in loincs)
    return f"""
latest_obs AS (
    SELECT patient_id, loinc, value, date,
           ROW_NUMBER() OVER (PARTITION BY patient_id, loinc ORDER BY date DESC) AS rn
    FROM observations
    WHERE patient_id IN (SELECT patient_id FROM eligible)
      AND loinc IN ({placeholders})
)
""".strip()


def _loinc_key(loinc: str) -> str:
    safe = "".join(ch if ch.isalnum() else "_" for ch in loinc)
    return f"lo_{safe}"


def _like_prefix(prefix: str) -> str:
    cleaned = prefix.strip().replace("%", "").replace("_", "")
    if not cleaned or len(cleaned) > _MAX_PREFIX:
        raise ValueError(f"Invalid code prefix {prefix!r}")
    return cleaned + "%"


def _render_filter(filt: Filter | None, params: ParamBag, patient: str, encounter: str) -> str:
    if filt is None or filt.op == "true":
        return "TRUE"
    if filt.op == "and":
        parts = [_render_filter(child, params, patient, encounter) for child in (filt.filters or [])]
        return "(" + " AND ".join(parts or ["TRUE"]) + ")"
    if filt.op == "or":
        parts = [_render_filter(child, params, patient, encounter) for child in (filt.filters or [])]
        return "(" + " OR ".join(parts or ["FALSE"]) + ")"
    if filt.op == "not":
        return "(NOT " + _render_filter(filt.filter, params, patient, encounter) + ")"
    if filt.op == "age_gte":
        return f"{patient}.age >= {params.add(int(filt.value))}"
    if filt.op == "age_lte":
        return f"{patient}.age <= {params.add(int(filt.value))}"
    if filt.op == "sex":
        return f"{patient}.sex = {params.add(str(filt.value))}"
    if filt.op == "region":
        return f"{patient}.region = {params.add(str(filt.value))}"
    if filt.op == "data_holder":
        return f"{patient}.data_holder = {params.add(str(filt.value))}"
    if filt.op == "has_condition":
        likes = " OR ".join(
            f"c.icd10 LIKE {params.add(_like_prefix(prefix))}" for prefix in (filt.icd10_prefixes or [])
        )
        return (
            "EXISTS (SELECT 1 FROM conditions c "
            f"WHERE c.patient_id = {patient}.patient_id AND ({likes or 'FALSE'}))"
        )
    if filt.op in {"has_active_medication", "has_medication"}:
        likes = " OR ".join(
            f"m.atc LIKE {params.add(_like_prefix(prefix))}" for prefix in (filt.atc_prefixes or [])
        )
        date_sql = ""
        if filt.op == "has_active_medication":
            on_date = params.add(filt.on_date or "2025-12-31")
            cast = f"CAST({on_date} AS DATE)"
            date_sql = f" AND m.start_date <= {cast} AND (m.end_date IS NULL OR m.end_date >= {cast})"
        return (
            "EXISTS (SELECT 1 FROM medications m "
            f"WHERE m.patient_id = {patient}.patient_id AND ({likes or 'FALSE'}){date_sql})"
        )
    if filt.op == "has_observation":
        token = params.add(str(filt.loinc))
        return (
            "EXISTS (SELECT 1 FROM observations o "
            f"WHERE o.patient_id = {patient}.patient_id AND o.loinc = {token})"
        )
    if filt.op == "encounter_type":
        return f"{encounter}.type = {params.add(str(filt.value))}"
    if filt.op == "encounter_start_between":
        start = params.add(filt.start)
        end = params.add(filt.end)
        return (
            f"{encounter}.start_date >= CAST({start} AS DATE) "
            f"AND {encounter}.start_date <= CAST({end} AS DATE)"
        )
    if filt.op == "encounter_primary_icd10":
        prefixes = filt.prefixes or filt.icd10_prefixes or []
        likes = " OR ".join(
            f"{encounter}.primary_icd10 LIKE {params.add(_like_prefix(prefix))}" for prefix in prefixes
        )
        return f"({likes or 'FALSE'})"
    raise ValueError(f"Unsupported filter {filt.op}")
