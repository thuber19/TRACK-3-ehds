/**
 * In-memory store for the mock backend. Resets when the dev server restarts.
 * The real backend replaces this with SQLite / DuckDB tables.
 */
import { EXAMPLE_REQUESTS } from "../examples";
import type { DataRequest, LogEvent, RequestDetail, RequestListItem } from "../types";
import { assess } from "./engine";

interface Entry extends RequestDetail {
  key: string;
}

type Store = { entries: Map<string, Entry>; seq: number };

const g = globalThis as unknown as { __hdabStore?: Store };

function seed(): Store {
  const store: Store = { entries: new Map(), seq: 0 };
  const now = Date.now();
  const seeded: Array<DataRequest & { simulate_failure?: string }> = [
    ...EXAMPLE_REQUESTS,
    { ...EXAMPLE_REQUESTS[7], simulate_failure: "Klinikum West" },
  ];
  seeded.forEach((req, i) => {
    const submitted = new Date(now - (seeded.length - i) * 1000 * 60 * 23);
    const run = assess(req, submitted);
    const key = nextKey(store, req.id);
    store.entries.set(key, {
      key,
      request: stripInternal(req),
      outcome: { ...run.outcome, request_id: key },
      status: run.failed ? "failed" : "completed",
      submitted_at: submitted.toISOString(),
      log: run.log,
    });
  });
  return store;
}

function nextKey(store: Store, id: string) {
  let key = id;
  let n = 1;
  while (store.entries.has(key)) key = `${id}-${++n}`;
  store.seq++;
  return key;
}

function stripInternal(req: DataRequest & { simulate_failure?: string }): DataRequest {
  const rest = { ...req };
  delete rest.simulate_failure;
  return rest;
}

export function getStore() {
  g.__hdabStore ??= seed();
  return g.__hdabStore;
}

export function submit(req: DataRequest & { simulate_failure?: string }) {
  const store = getStore();
  const submitted = new Date();
  const run = assess(req, submitted);
  const key = nextKey(store, req.id);
  const entry: Entry = {
    key,
    request: stripInternal(req),
    outcome: { ...run.outcome, request_id: key },
    status: run.failed ? "failed" : "completed",
    submitted_at: submitted.toISOString(),
    log: run.log,
  };
  store.entries.set(key, entry);
  return entry;
}

export function list(): RequestListItem[] {
  return [...getStore().entries.values()]
    .map((e) => ({
      id: e.key,
      applicant_name: e.request.applicant.name,
      organisation: e.request.applicant.organisation,
      requested_as: e.request.requested_as,
      purpose: e.request.purpose,
      decision: e.outcome?.decision ?? null,
      articles: e.outcome?.articles.map((a) => Number(a.article)) ?? [],
      submitted_at: e.submitted_at,
      processing_ms: e.outcome?.processing_ms ?? null,
      status: e.status,
    }))
    .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
}

export function get(id: string): RequestDetail | null {
  const e = getStore().entries.get(id);
  if (!e) return null;
  const { request, outcome, status, submitted_at, log } = e;
  return { request, outcome, status, submitted_at, log };
}

export function logDownloadAttempt(speId: string) {
  const entry = [...getStore().entries.values()].find((e) => e.outcome?.spe?.spe_id === speId);
  if (!entry) return null;
  const event: LogEvent = {
    id: `${entry.key}-dl-${entry.log.length + 1}`,
    timestamp: new Date().toISOString(),
    duration_ms: 3,
    status: "blocked",
    step: "download_attempt",
    data: {
      spe_id: speId,
      http_status: 403,
      message: "Data cannot leave the secure processing environment (Art. 73).",
    },
  };
  entry.log.push(event);
  return event;
}
