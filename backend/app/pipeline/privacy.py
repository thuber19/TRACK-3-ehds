"""Last check before an answer is stored or shown to an applicant."""

from __future__ import annotations

import re

_PATIENT = re.compile(r"^p-[0-9a-f]{6,}$", re.IGNORECASE)


class PrivacyError(Exception):
    pass


def privacy_guard(answer) -> None:
    """Raise if a statistical answer contains a raw count below 10, a patient id, or records.

    The SPE cohort size is the one number that may be exact, including values below 10.
    """
    if answer is None:
        return
    _walk(answer, None)


def _walk(value, key: str | None) -> None:
    if key in {"patient_id", "birth_date", "encounter_id"}:
        raise PrivacyError("patient field")
    if isinstance(value, dict):
        for child_key, child in value.items():
            _walk(child, str(child_key))
        return
    if isinstance(value, list):
        if any(isinstance(item, dict) for item in value):
            raise PrivacyError("record list")
        for item in value:
            _walk(item, key)
        return
    if isinstance(value, bool):
        return
    if isinstance(value, int):
        if key == "cohort_size":
            return
        if value < 10:
            raise PrivacyError("raw count below 10")
        return
    if isinstance(value, str) and _PATIENT.match(value):
        raise PrivacyError("patient id")
