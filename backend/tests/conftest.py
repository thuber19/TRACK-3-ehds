from __future__ import annotations

from pathlib import Path

import pytest

from app.config import find_root
from app.nodes.csv_dev import load_csv_nodes

ROOT = find_root()


@pytest.fixture(scope="session")
def nodes():
    return load_csv_nodes(ROOT / "data")
