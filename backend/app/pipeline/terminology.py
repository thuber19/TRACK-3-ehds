"""Code catalog taken from the hospitals. Descriptions only — never patient rows."""

from __future__ import annotations

from dataclasses import dataclass, field

from app.pipeline.spec import Filter, QuerySpec


@dataclass
class Catalog:
    icd10: list[dict] = field(default_factory=list)
    atc: list[dict] = field(default_factory=list)
    loinc: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"icd10": self.icd10, "atc": self.atc, "loinc": self.loinc}

    def codes(self, kind: str) -> list[str]:
        return [row["code"] for row in getattr(self, kind)]

    def matches(self, kind: str, prefix: str) -> bool:
        return any(str(row["code"]).startswith(prefix) for row in getattr(self, kind))

    def matching_codes(self, kind: str, prefix: str) -> list[str]:
        return [str(row["code"]) for row in getattr(self, kind) if str(row["code"]).startswith(prefix)]


def merge_catalogs(nodes: list) -> Catalog:
    buckets: dict[str, dict[str, str]] = {"icd10": {}, "atc": {}, "loinc": {}}
    for node in nodes:
        catalog = node.code_catalog()
        for kind in buckets:
            for row in catalog.get(kind, []):
                code = str(row.get("code") or "").strip()
                if not code:
                    continue
                description = str(row.get("description") or "").strip()
                current = buckets[kind].get(code, "")
                if description and (not current or len(description) > len(current)):
                    buckets[kind][code] = description
                else:
                    buckets[kind].setdefault(code, current)
    return Catalog(
        icd10=[{"code": code, "description": buckets["icd10"][code]} for code in sorted(buckets["icd10"])],
        atc=[{"code": code, "description": buckets["atc"][code]} for code in sorted(buckets["atc"])],
        loinc=[{"code": code, "description": buckets["loinc"][code]} for code in sorted(buckets["loinc"])],
    )


def collect_code_uses(spec: QuerySpec) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []

    def walk(filt: Filter | None) -> None:
        if filt is None:
            return
        for prefix in filt.icd10_prefixes or []:
            found.append(("icd10", prefix))
        for prefix in filt.prefixes or []:
            found.append(("icd10", prefix))
        for prefix in filt.atc_prefixes or []:
            found.append(("atc", prefix))
        if filt.loinc:
            found.append(("loinc", filt.loinc))
        for child in filt.filters or []:
            walk(child)
        walk(filt.filter)

    walk(spec.base)
    for metric in spec.metrics:
        walk(metric.filter)
        if metric.value:
            found.append(("loinc", metric.value.loinc))
    if spec.spe and spec.spe.observation_loinc:
        for code in spec.spe.observation_loinc:
            found.append(("loinc", code))
    return found
