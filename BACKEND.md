# Backend contract

The frontend talks to the backend only through `src/lib/api.ts`. Every response shape is defined in
`src/lib/types.ts` — treat that file as the contract.

Until the real backend exists, a mock runs inside Next.js under `/api` (`src/app/api/**`, logic in
`src/lib/mock/`). To switch to the real backend, set:

```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

| Endpoint                   | Returns                                   |
| -------------------------- | ----------------------------------------- |
| `POST /requests`           | `RequestOutcome` (422 + `issues` if invalid) |
| `GET /requests`            | `RequestListItem[]`                        |
| `GET /requests/{id}`       | `RequestDetail` (request, outcome, log)    |
| `POST /spe/{spe_id}/download` | always `403` `{ message }`, appends a `download_attempt` log event |

## Rules the UI relies on

- Results contain only `CellValue`s after the small-cell rule: `{kind:"value"}`, `{kind:"lt10"}` or
  `{kind:"suppressed"}`. Raw suppressed values must never be sent — not to applicants, not to staff.
- Every requested group is listed in `Dimension.groups`, including empty ones (all 9 regions, every age band).
- Apply the small-cell rule **after** merging the three hospitals. Hospitals return sums and counts only.
- If any hospital fails or times out, return `federation.status = "failed"` and `results: null`.
  The UI shows "No results released — Klinikum West unavailable" instead of partial numbers.
- `federated_execution` log entries carry status, query time and opted-out count per hospital — never
  per-hospital result counts.
- R09-style downgrades: set `requested_as: "records"` and `granted_as: "statistics"`; the UI shows the
  "You asked for records…" message automatically.

## Mock extras

- The store is seeded with R01–R10 plus `R08-2`, a run where Klinikum West timed out.
- Add `"simulate_failure": "Klinikum West"` to a request to reproduce that state.
