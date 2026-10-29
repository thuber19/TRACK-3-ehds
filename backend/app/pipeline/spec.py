"""QuerySpec: the only description of a query that the compiler accepts."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Filter(BaseModel):
    model_config = ConfigDict(extra="ignore")

    op: Literal[
        "and",
        "or",
        "not",
        "true",
        "age_gte",
        "age_lte",
        "sex",
        "region",
        "data_holder",
        "has_condition",
        "has_active_medication",
        "has_medication",
        "has_observation",
        "encounter_type",
        "encounter_start_between",
        "encounter_primary_icd10",
    ] = "true"
    filters: list[Filter] | None = None
    filter: Filter | None = None
    value: int | str | None = None
    icd10_prefixes: list[str] | None = None
    atc_prefixes: list[str] | None = None
    on_date: str | None = None
    loinc: str | None = None
    start: str | None = None
    end: str | None = None
    prefixes: list[str] | None = None


class AgeBand(BaseModel):
    model_config = ConfigDict(extra="ignore")

    label: str
    min: int
    max: int | None = None


class GroupSpec(BaseModel):
    model_config = ConfigDict(extra="ignore")

    dimension: Literal["region", "age_band", "sex", "data_holder"]
    bands: list[AgeBand] | None = None


class ObsValue(BaseModel):
    model_config = ConfigDict(extra="ignore")

    loinc: str
    pick: Literal["latest", "any"] = "latest"


class Metric(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    type: Literal["count", "percent", "mean"]
    filter: Filter | None = None
    numerator: str | None = None
    denominator: str | None = None
    value: ObsValue | None = None
    output: bool = True


class SpeSpec(BaseModel):
    model_config = ConfigDict(extra="ignore")

    record_types: list[str] = Field(default_factory=list)
    observation_loinc: list[str] | None = None


class QuerySpec(BaseModel):
    model_config = ConfigDict(extra="ignore")

    reference_date: str = "2025-12-31"
    unit: Literal["patient", "encounter"] = "patient"
    base: Filter = Field(default_factory=lambda: Filter(op="true"))
    groups: list[GroupSpec] = Field(default_factory=list)
    metrics: list[Metric] = Field(default_factory=list)
    spe: SpeSpec | None = None


class DataRequestIn(BaseModel):
    """Applicant payload. Unknown fields are retained on the raw JSON and ignored here."""

    model_config = ConfigDict(extra="allow")

    id: str | None = None
    submitted: str | None = None
    applicant: dict = Field(default_factory=dict)
    requested_as: str = ""
    requested_format: str = ""
    purpose: str = ""
    question: str = ""
    definitions: list[str] = Field(default_factory=list)

    def applicant_name(self) -> str:
        return str(self.applicant.get("name") or "")

    def organisation(self) -> str:
        return str(self.applicant.get("organisation") or "")

    def country(self) -> str:
        return str(self.applicant.get("country") or "")

    def request_text(self) -> str:
        parts = [self.purpose, self.question, self.organisation(), *self.definitions]
        return "\n".join(part.strip() for part in parts if part and part.strip())
