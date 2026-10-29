"""Environment settings. Paths resolve to the repository root in local runs and to /app in Docker."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def find_root() -> Path:
    here = Path(__file__).resolve()
    for candidate in [here.parent, *here.parents]:
        if (candidate / "requests" / "expected.json").is_file() and (candidate / "data").is_dir():
            return candidate
    return here.parents[2]


def _split_nodes(raw: str) -> list[tuple[str, str]]:
    nodes: list[tuple[str, str]] = []
    if not raw.strip():
        return nodes
    for part in raw.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        name, url = part.split("=", 1)
        name, url = name.strip(), url.strip()
        if name and url:
            nodes.append((name, url))
    return nodes


@dataclass(frozen=True)
class Settings:
    data_mode: str
    hospital_nodes: list[tuple[str, str]]
    openai_api_key: str
    openai_model: str
    session_secret: str
    root: Path
    data_dir: Path
    requests_dir: Path
    var_dir: Path
    frontend_dist: Path
    seed_applicant_username: str
    seed_applicant_password: str
    seed_staff_username: str
    seed_staff_password: str
    node_timeout_s: float = 20.0

    @property
    def database_path(self) -> Path:
        return self.var_dir / "app.db"

    @property
    def spe_dir(self) -> Path:
        return self.var_dir / "spe"

    @classmethod
    def from_env(cls) -> Settings:
        root = Path(os.environ["HDAB_ROOT"]).resolve() if os.environ.get("HDAB_ROOT") else find_root()
        _load_dotenv(root / ".env")
        data_mode = os.environ.get("DATA_MODE", "csv").strip().lower()
        var_dir = Path(os.environ.get("VAR_DIR", root / "var")).resolve()
        return cls(
            data_mode=data_mode,
            hospital_nodes=_split_nodes(os.environ.get("HOSPITAL_NODES", "")),
            openai_api_key=os.environ.get("OPENAI_API_KEY", "").strip(),
            openai_model=os.environ.get("OPENAI_MODEL", "gpt-4.1").strip() or "gpt-4.1",
            session_secret=os.environ.get("SESSION_SECRET", "dev-secret-change-me"),
            root=root,
            data_dir=Path(os.environ.get("DATA_DIR", root / "data")).resolve(),
            requests_dir=Path(os.environ.get("REQUESTS_DIR", root / "requests")).resolve(),
            var_dir=var_dir,
            frontend_dist=Path(os.environ.get("FRONTEND_DIST", root / "frontend" / "dist")).resolve(),
            seed_applicant_username=os.environ.get("SEED_APPLICANT_USERNAME", "applicant"),
            seed_applicant_password=os.environ.get("SEED_APPLICANT_PASSWORD", "applicant"),
            seed_staff_username=os.environ.get("SEED_STAFF_USERNAME", "staff"),
            seed_staff_password=os.environ.get("SEED_STAFF_PASSWORD", "staff"),
        )
