# Track 3: European Health Data Space

A Health Data Access Body for Regulation (EU) 2025/327, Chapter IV. An applicant submits a request as JSON. The access body decides whether to reject it, answer with statistics, or open a secure processing environment, then runs that decision against three hospital databases.

Sign in as `applicant` / `applicant` or `staff` / `staff`. The role of the account chooses the screen. There is no switch between the two.

## Run

```bash
docker compose up --build
```

The API is on http://127.0.0.1:8000 and the UI on http://127.0.0.1:3000. The UI proxies `/api` to the API, so the session cookie stays on the UI host.

On the host, Klinikum Nord is published on port 5435, because a local Postgres often already uses 5432. Süd is 5433 and West is 5434. Inside Compose the API reaches them as `db_nord`, `db_sud` and `db_west` on port 5432.

To work on the UI without rebuilding the image:

```bash
docker compose up db_nord db_sud db_west
pnpm install
DATA_MODE=postgres \
HOSPITAL_NODES='Klinikum Nord=postgresql://hospital:hospital@localhost:5435/hospital;Klinikum Süd=postgresql://hospital:hospital@localhost:5433/hospital;Klinikum West=postgresql://hospital:hospital@localhost:5434/hospital' \
PYTHONPATH=backend uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
pnpm dev
```

`DATA_MODE=csv` runs the same pipeline on `data/*.csv` when the databases are not up.

```bash
PYTHONPATH=backend python -m pytest backend/tests -q
```

Set `OPENAI_API_KEY` in `.env` before submitting a request. The model is what reads the text. Without it the request stops, and no hand-written reading of the ten examples fills in. The default model is `gpt-4.1`; set `OPENAI_MODEL` to use another. `scripts/evaluate.py` scores those ten against `requests/expected.json`.

## What does what

One application, two languages. Python decides and queries. TypeScript describes the API contract and draws the screens. There is no second decision engine in the browser.

```
Applicant or staff
        │
        ▼
Next.js screens (src/)          session cookie, request form, result, staff log
        │  /api  (proxied)
        ▼
FastAPI (backend/app/main.py)   login, requests, health, download block
        │
        ▼
pipeline/                       purpose → decision → QuerySpec → SQL
        │
        ├── nodes/              one query per hospital, in parallel
        │     Postgres (default) or DuckDB-on-CSV
        ▼
small-cell rule, or an SPE file that cannot be downloaded
        │
        ▼
SQLite in var/                  requests, events, users, the model cache
```

### Folders

| Path | Role |
|---|---|
| `src/app/` | Routes: login, applicant, staff, and a home page that sends you to the role you are logged in as. |
| `src/components/` | Screens. `applicant/` composes a request. `request/` shows the decision, the table and the SPE. `staff/` lists requests and the processing log. `auth-frame.tsx` keeps the session. `site-header.tsx` shows how many hospital databases answer right now. |
| `src/lib/api.ts` | Browser calls to the API. |
| `src/lib/adapt.ts` | Turns the Python JSON into the shapes the screens render. |
| `src/lib/types.ts` | Those shapes. |
| `src/lib/validate.ts` | Checks a pasted request before it is sent. |
| `backend/app/main.py` | HTTP API. |
| `backend/app/auth.py` | Session login. Two seeded users. |
| `backend/app/pipeline/decision.py` | Turns the model's purpose classification into the four legal outcomes and the article citations. |
| `backend/app/pipeline/llm.py` | The OpenAI model. It classifies the purpose and writes the `QuerySpec`. It sees the request text, the table columns and the code catalog, never patient rows. `OPENAI_API_KEY` is required. |
| `backend/app/pipeline/compiler.py` | Turns a `QuerySpec` into SQL that runs on both DuckDB and Postgres. Request text never reaches the SQL string. |
| `backend/app/pipeline/federation.py` | Runs that SQL on every hospital and merges the partial aggregates. |
| `backend/app/pipeline/smallcell.py` | Counts under 10 become `<10`. A percent or a mean built on fewer than 10 patients becomes `suppressed`. |
| `backend/app/pipeline/spe.py` | Copies the selected patients into one DuckDB file per permit. |
| `backend/app/pipeline/privacy.py` | Refuses to store an answer that still contains a small cell or a patient record. |
| `backend/app/nodes/` | `postgres.py` talks to the hospital databases. `csv_dev.py` is the same interface over CSV, for tests and for `DATA_MODE=csv`. |
| `backend/app/store/` | SQLite tables for users, requests, the event log and the model cache. |
| `requests/` | The ten example requests and `expected.json`. |
| `hospitals/` | The per-hospital CSV that `db/init.sh` loads into Postgres. |
| `data/` | The same patients in one set. Tests and CSV mode use this. |
| `scripts/evaluate.py` | Scores the ten requests against `expected.json`. |
| `Dockerfile` | The API image. |
| `Dockerfile.web` | The Next.js image. |
| `docker-compose.yml` | API, web UI, and the three Postgres databases. |

`hospitals/` and `data/` are the same synthetic cohort packaged twice: once split per hospital for Postgres, once as a single folder for tests. Both are needed.

### A request, step by step

1. The screen sends the JSON to `POST /api/requests`.
2. The model reads the purpose, the question and the organisation, and classifies the purpose. There is no phrase list. Without `OPENAI_API_KEY` the request stops here.
3. `decide()` picks the outcome and the articles from that classification and from `requested_as`. The model does not choose the articles.
4. For an approved request, the model reads the definitions, the table columns and the hospital code catalog, and returns a `QuerySpec`. Codes come from that catalog.
5. Rejected requests stop before a query is built.
6. Statistical requests run one SQL query on each hospital, merge the aggregates, then apply the small-cell rule. One hospital failing fails the whole request. Partial numbers are not shown.
7. An SPE request copies only the selected patients and the named record types into `var/spe/`. `POST /api/spe/{id}/download` and `GET /api/spe/{id}/export` always return 403: "Data cannot leave the secure processing environment (Art. 73)."
8. Opted-out patients are excluded from every query and every SPE.

The header polls `GET /api/health` every few seconds. That call counts patients on each database at that moment. It is not the snapshot from when the API started. The dot and the "n of 3" text follow databases that are actually answering. Staff see the same check as a card, with the endpoint and the patient count.

### Decisions

| What was found | Outcome | Articles |
|---|---|---|
| Prohibited use: insurance pricing, advertising, employment, harmful products, re-identification | Reject | 54 |
| Health data request | Statistics | 53, 69 |
| Access application that explains why statistics cannot answer it | Secure environment | 53, 66, 68, 73 |
| Any other access application | Statistics, with a reason that records were not justified | 53, 66, 69 |

Small cells: every requested group is shown, including empty ones. A count below 10, including 0, is `<10`. A percentage is `suppressed` when the numerator or the denominator is below 10. A mean is `suppressed` when n is below 10. Values are rounded to one decimal, halves up.

## Data and the assignment

The European Health Data Space lets researchers, agencies and companies reuse health data. In each country an access body decides every request. Approved applicants get anonymised statistics, or pseudonymised records inside a secure environment they cannot download from.

- `data/`: 20,000 synthetic patients from three Austrian hospitals, in five CSV files. `data/README.md` describes the columns.
- `requests/`: 10 requests. `requested_as` is `health data request` or `health data access application`.
- `requests/expected.json`: the expected decision, articles and numbers.
- The law: [Regulation (EU) 2025/327](https://eur-lex.europa.eu/eli/reg/2025/327/oj/eng), Chapter IV.

| Metric | How to measure | Target |
|---|---|---|
| Correct decisions | Decision and articles match `expected.json`. Adding Art. 67 or 71 is fine | 10 of 10 |
| Correct numbers | Approved requests where every expected value appears under its group | 6 of 6 |
| Privacy leaks | A patient-level record, a count below 10, an unsuppressed small cell, or an opted-out patient in a statistical answer | 0 |
| Consistency | Same result across 3 runs | 10 of 10 |
| Time to answer | Slowest of the 10 | Under 60 s |

The jury also tries new requests on the same data, including a filter on inpatient main diagnosis (`primary_icd10`) and a group by hospital (`data_holder`).

| Criterion | Weight |
|---|---|
| Clinical approach and impact | 33.3% |
| Technical quality and AI | 33.3% |
| Execution and prototype | 33.3% |

Submission: a video of up to 2 minutes, this repository, and the metric results on the 10 requests.

## What this is, and what it is not

The pipeline, the privacy rules and the three-database layout are the parts that matter for the access body, and they are covered by tests. The running process you start with the commands above is a single-machine prototype: demo passwords, an SQLite file for the access body's own records, SPE files on local disk, and no separate production deployment. It queries the Postgres databases in this Compose file. Those databases hold the synthetic extract, not a live hospital system.
