"""OpenAI purpose check and QuerySpec proposal.

The model sees request text and, for the spec, the code catalog. It never sees patient rows.
Responses are cached by the SHA-256 of the normalised request text and the prompt version.
"""

from __future__ import annotations

import hashlib
import json
from typing import Callable

from app.config import Settings
from app.pipeline.decision import PurposeAssessment
from app.pipeline.spec import DataRequestIn, QuerySpec
from app.pipeline.terminology import Catalog

PROMPT_PURPOSE = "purpose-v1"
PROMPT_SPEC = "spec-v1"

PURPOSE_SYSTEM = """You classify a request to reuse electronic health data under the European Health Data Space.

Allowed secondary uses (Article 53) include scientific research, public health, policy-making, official statistics, education and teaching, developing and testing algorithms, and work that improves patient care. More than one may apply.

Prohibited secondary uses (Article 54) include setting insurance premiums or taking underwriting decisions, taking decisions about a person's job or employment, advertising and marketing, developing or promoting products that harm health (including nicotine and tobacco products), and any attempt to re-identify a person. If any prohibited use is present, set prohibited to true even if the applicant also mentions an allowed purpose.

justifies_patient_level is true only when the applicant explains why aggregated statistics cannot do the job, for example because they must train a model on individual histories. Asking for records, or saying the word pseudonymised, is not itself a justification. When the question is about counts, rates or averages, set justifies_patient_level to false.

Quote a short span from the text you were given. Do not invent clinical facts and do not ask for patient-level data."""

SPEC_SYSTEM = """You translate a health-data request into a QuerySpec. You receive the request text, the table columns, and a catalog of ICD-10, ATC and LOINC codes with their descriptions. You do not receive patient records and you must not invent patient identifiers. You do not write SQL.

Use only codes or prefixes that appear in the catalog. Map plain-English conditions, drugs and measurements onto those codes. Age is calculated on the reference date, default 2025-12-31. A medication is active on a date when start_date is on or before that date and end_date is empty or on or after it. "Latest" means the observation with the latest date for that LOINC code.

Prefer unit "patient". Use unit "encounter" only when the request counts stays or visits rather than people. Groups are region, age_band, sex or data_holder. Age bands come from the request, not from the data. Metric names are snake_case and follow the wording of the report line. Percent metrics name their numerator and denominator count metrics. A mean metric names a LOINC code and pick "latest".

Filter operations are only: and, or, not, true, age_gte, age_lte, sex, region, data_holder, has_condition, has_active_medication, has_medication, has_observation, encounter_type, encounter_start_between, encounter_primary_icd10. has_condition carries icd10_prefixes. Medication filters carry atc_prefixes. has_observation carries loinc. encounter_primary_icd10 carries prefixes.

For a secure processing environment, set spe.record_types to the record families the applicant asked to analyse and observation_loinc to the LOINC codes they named. Leave spe null when the report asks for statistics."""


def purpose_from_model(
    settings: Settings,
    request: DataRequestIn,
    cache_get: Callable[[str], str | None],
    cache_put: Callable[[str, str, str, str], None],
) -> PurposeAssessment | None:
    if not settings.openai_api_key:
        return None
    user = json.dumps(
        {
            "purpose": request.purpose,
            "question": request.question,
            "organisation": request.organisation(),
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    payload = _cached_tool(
        settings,
        prompt_version=PROMPT_PURPOSE,
        tool_name="submit_purpose",
        system=PURPOSE_SYSTEM,
        user=user,
        schema=_purpose_schema(),
        cache_get=cache_get,
        cache_put=cache_put,
    )
    purposes = payload.get("allowed_purpose") or payload.get("allowed_purposes") or []
    if isinstance(purposes, str):
        purposes = [part.strip() for part in purposes.split("|") if part.strip() and part.strip() != "null"]
    category = payload.get("prohibited_category")
    if category in ("", "null"):
        category = None
    return PurposeAssessment(
        prohibited=bool(payload.get("prohibited")),
        prohibited_category=category,
        allowed_purposes=list(purposes),
        evidence=payload.get("evidence"),
        justifies_patient_level=bool(payload.get("justifies_patient_level")),
        justification_evidence=payload.get("justification_evidence"),
        source="model",
    )


def spec_from_model(
    settings: Settings,
    request: DataRequestIn,
    catalog: Catalog,
    cache_get: Callable[[str], str | None],
    cache_put: Callable[[str, str, str, str], None],
    validation_error: str | None = None,
) -> QuerySpec | None:
    if not settings.openai_api_key:
        return None
    user_obj = {
        "purpose": request.purpose,
        "question": request.question,
        "organisation": request.organisation(),
        "requested_as": request.requested_as,
        "requested_format": request.requested_format,
        "definitions": request.definitions,
        "tables": {
            "patients": ["patient_id", "sex", "birth_date", "region", "data_holder", "opted_out"],
            "conditions": ["patient_id", "icd10", "description", "onset_date"],
            "medications": ["patient_id", "atc", "name", "start_date", "end_date"],
            "observations": ["patient_id", "loinc", "name", "value", "unit", "date"],
            "encounters": ["encounter_id", "patient_id", "data_holder", "type", "start_date", "end_date", "primary_icd10"],
        },
        "catalog": catalog.as_dict(),
    }
    if validation_error:
        user_obj["validation_error"] = validation_error
    user = json.dumps(user_obj, ensure_ascii=False, sort_keys=True)
    payload = _cached_tool(
        settings,
        prompt_version=PROMPT_SPEC,
        tool_name="submit_query_spec",
        system=SPEC_SYSTEM,
        user=user,
        schema=_spec_schema(),
        cache_get=cache_get,
        cache_put=cache_put,
        skip_cache=validation_error is not None,
    )
    return QuerySpec.model_validate(payload)


def _cached_tool(
    settings: Settings,
    *,
    prompt_version: str,
    tool_name: str,
    system: str,
    user: str,
    schema: dict,
    cache_get: Callable[[str], str | None],
    cache_put: Callable[[str, str, str, str], None],
    skip_cache: bool = False,
) -> dict:
    key = hashlib.sha256(f"{prompt_version}\n{user}".encode("utf-8")).hexdigest()
    if not skip_cache:
        cached = cache_get(key)
        if cached:
            return json.loads(cached)
    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)
    message = client.chat.completions.create(
        model=settings.openai_model,
        temperature=0,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        tools=[
            {
                "type": "function",
                "function": {
                    "name": tool_name,
                    "description": "Submit the structured result.",
                    "parameters": schema,
                },
            }
        ],
        tool_choice={"type": "function", "function": {"name": tool_name}},
    )
    calls = message.choices[0].message.tool_calls or []
    if not calls:
        raise RuntimeError("Model did not return a tool call")
    payload = json.loads(calls[0].function.arguments)
    if not isinstance(payload, dict):
        raise RuntimeError("Model tool call was not an object")
    if not skip_cache:
        cache_put(key, prompt_version, settings.openai_model, json.dumps(payload, ensure_ascii=False))
    return payload


def _purpose_schema() -> dict:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "prohibited": {"type": "boolean"},
            "prohibited_category": {
                "type": ["string", "null"],
                "enum": [
                    "insurance_premiums",
                    "employment_decisions",
                    "advertising_marketing",
                    "harmful_products",
                    "reidentification",
                    "other",
                    None,
                ],
            },
            "allowed_purpose": {"type": "string"},
            "evidence": {"type": "string"},
            "justifies_patient_level": {"type": "boolean"},
            "justification_evidence": {"type": ["string", "null"]},
        },
        "required": [
            "prohibited",
            "prohibited_category",
            "allowed_purpose",
            "evidence",
            "justifies_patient_level",
            "justification_evidence",
        ],
    }


def _spec_schema() -> dict:
    filter_schema = {"type": "object", "additionalProperties": True}
    return {
        "type": "object",
        "additionalProperties": True,
        "properties": {
            "reference_date": {"type": "string"},
            "unit": {"type": "string", "enum": ["patient", "encounter"]},
            "base": filter_schema,
            "groups": {"type": "array"},
            "metrics": {"type": "array"},
            "spe": {"type": ["object", "null"]},
        },
        "required": ["reference_date", "unit", "base", "groups", "metrics"],
    }
