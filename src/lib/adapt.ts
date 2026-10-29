import { ARTICLES } from "./constants";
import { requestKind } from "./constants";
import type {
  CellValue,
  DataRequest,
  Decision,
  FederationSummary,
  LogEvent,
  LogStatus,
  Metric,
  RequestDetail,
  RequestListItem,
  RequestOutcome,
  RequestStatus,
  ResultRow,
  StatisticalResult,
} from "./types";

type Row = Record<string, unknown>;

const STATUS: Record<string, RequestStatus> = {
  RECEIVED: "processing",
  PROCESSING: "processing",
  DONE: "completed",
  ERROR: "failed",
};

const LOG_STATUS: Record<string, LogStatus> = {
  ok: "ok",
  warn: "warning",
  error: "error",
};

export function toListItem(row: Row): RequestListItem {
  const summary = record(row.summary);
  const applicant = record(summary.applicant);
  return {
    id: String(row.id),
    applicant_name: text(summary.applicant) || text(applicant.name),
    organisation: text(summary.organisation),
    requested_as: requestKind(text(summary.requested_as)),
    purpose: text(summary.purpose),
    decision: (row.decision as Decision | null) ?? null,
    articles: articlesOf(row.articles),
    submitted_at: text(row.created_at),
    processing_ms: numberOrNull(row.duration_ms),
    status: STATUS[text(row.status)] ?? "completed",
  };
}

export function toOutcome(row: Row): RequestOutcome {
  const summary = record(row.summary);
  const decision = (row.decision as Decision) || "REJECT";
  const requested = requestKind(text(summary.requested_as));
  const spe = record(row.spe);
  const answer = record(row.answer);
  const cohort = typeof answer.cohort_size === "number" ? answer.cohort_size : null;
  return {
    request_id: String(row.id),
    decision,
    requested_as: requested,
    granted_as: decision === "REJECT" ? "none" : decision === "APPROVE_SPE" ? "records" : "statistics",
    reason: text(row.reason),
    articles: articlesOf(row.articles).map((article) => ({
      article,
      explanation: ARTICLES[article]?.explanation ?? "",
    })),
    results: cohort === null ? toResults(row.answer, text(summary.question)) : null,
    spe:
      decision === "APPROVE_SPE" && cohort !== null
        ? {
            spe_id: text(spe.id) || String(row.id),
            schema_name: String(row.id),
            cohort_size: cohort,
            record_types: strings(spe.record_types),
            created_at: text(row.finished_at) || text(row.created_at),
          }
        : null,
    federation: (row.federation as FederationSummary | null) ?? null,
    processing_ms: Number(row.duration_ms ?? 0),
  };
}

export function toDetail(row: Row): RequestDetail {
  const raw = record(row.raw);
  const summary = record(row.summary);
  const applicant = record(raw.applicant);
  const request: DataRequest = {
    id: text(raw.id) || String(row.id),
    applicant: {
      name: text(applicant.name) || text(summary.applicant),
      organisation: text(applicant.organisation) || text(summary.organisation),
      country: text(applicant.country) || text(summary.country),
    },
    requested_as: requestKind(text(raw.requested_as) || text(summary.requested_as)),
    requested_format: text(raw.requested_format) || text(summary.requested_format),
    purpose: text(raw.purpose) || text(summary.purpose),
    question: text(raw.question) || text(summary.question),
    definitions: Array.isArray(raw.definitions) ? (raw.definitions as DataRequest["definitions"]) : [],
  };
  return {
    request,
    outcome: row.decision ? toOutcome({ ...row, summary: { ...summary, ...raw, applicant: request.applicant.name } }) : null,
    status: STATUS[text(row.status)] ?? "completed",
    submitted_at: text(row.created_at),
    log: toLog(Array.isArray(row.events) ? (row.events as Row[]) : [], String(row.id)),
  };
}

function toResults(answer: unknown, question: string): StatisticalResult[] | null {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return null;
  const table = answer as Record<string, unknown>;
  const groups = Object.keys(table);
  if (!groups.length) return null;
  const sample = table[groups[0]];
  if (isMetricMap(sample) && isMetricMap(Object.values(sample)[0])) {
    return [crossTable(table, question)];
  }
  if (isMetricMap(sample)) {
    return [metricTable(table, question)];
  }
  return [valueTable(table, question)];
}

function metricTable(table: Record<string, unknown>, question: string): StatisticalResult {
  const groups = Object.keys(table);
  const names = Object.keys(table[groups[0]] as Record<string, unknown>);
  return {
    title: question || "Statistics",
    dimensions: [{ key: "group", label: "Group", kind: "other", groups }],
    metrics: names.map(metricOf),
    rows: groups.map((group) => ({
      group: [group],
      values: cells(table[group] as Record<string, unknown>),
    })),
  };
}

function valueTable(table: Record<string, unknown>, question: string): StatisticalResult {
  const groups = Object.keys(table);
  return {
    title: question || "Statistics",
    dimensions: [{ key: "group", label: "Group", kind: "other", groups }],
    metrics: [metricOf("value")],
    rows: groups.map((group) => ({ group: [group], values: { value: cell(table[group]) } })),
  };
}

function crossTable(table: Record<string, unknown>, question: string): StatisticalResult {
  const outer = Object.keys(table);
  const inner = Object.keys(table[outer[0]] as Record<string, unknown>);
  const names = Object.keys((table[outer[0]] as Record<string, unknown>)[inner[0]] as Record<string, unknown>);
  const rows: ResultRow[] = [];
  for (const first of outer) {
    const nested = table[first] as Record<string, unknown>;
    for (const second of Object.keys(nested)) {
      rows.push({ group: [first, second], values: cells(nested[second] as Record<string, unknown>) });
    }
  }
  return {
    title: question || "Statistics",
    dimensions: [
      { key: "group1", label: "Group", kind: "other", groups: outer },
      { key: "group2", label: "Group", kind: "other", groups: inner },
    ],
    metrics: names.map(metricOf),
    rows,
  };
}

function metricOf(name: string): Metric {
  const type = name.endsWith("_pct") || name.includes("percent") ? "percent" : name.startsWith("mean_") ? "mean" : "count";
  return {
    key: name,
    label: name.replaceAll("_", " "),
    type,
    unit: type === "percent" ? "%" : undefined,
  };
}

function cells(source: Record<string, unknown>): Record<string, CellValue> {
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, cell(value)]));
}

function cell(value: unknown): CellValue {
  if (value === "<10") return { kind: "lt10" };
  if (value === "suppressed") return { kind: "suppressed" };
  return { kind: "value", value: typeof value === "number" ? value : Number(value) };
}

function toLog(events: Row[], requestId: string): LogEvent[] {
  const log: LogEvent[] = [];
  const queries = events.filter((item) => item.step === "query" && item.node);
  let queriesUsed = false;
  for (const item of events) {
    if (item.step === "query") {
      if (!queriesUsed && queries.length) {
        queriesUsed = true;
        log.push(federatedEvent(queries));
      }
      continue;
    }
    if (item.step === "decision") {
      const mapped = mapEvent(item, requestId);
      if (mapped) log.push(mapped);
      const details = record(item.details);
      log.push({
        id: `${item.id}-decision`,
        timestamp: text(item.ts),
        duration_ms: 0,
        status: "ok",
        step: "decision",
        data: {
          decision: text(details.decision) as Decision,
          articles: articlesOf(details.articles),
        },
      });
      continue;
    }
    const mapped = mapEvent(item, requestId);
    if (mapped) log.push(mapped);
  }
  return log;
}

function mapEvent(item: Row, requestId: string): LogEvent | null {
  const base = {
    id: String(item.id),
    timestamp: text(item.ts),
    duration_ms: Number(item.duration_ms ?? 0),
    status: LOG_STATUS[text(item.status)] ?? "info",
  } as const;
  const details = record(item.details);
  switch (item.step) {
    case "validate":
      return { ...base, step: "received", data: { valid: true, schema_errors: [] } };
    case "purpose_check":
      return {
        ...base,
        step: "purpose_check",
        data: {
          allowed: !details.prohibited,
          prohibited_category: details.prohibited_category ? String(details.prohibited_category) : null,
          article: details.prohibited ? 54 : null,
          explanation: text(details.evidence) || text(details.justification_evidence) || text(rowPurposes(details)),
        },
      };
    case "decision":
      return {
        ...base,
        step: "classification",
        status: base.status,
        data: classification(details),
      };
    case "interpret": {
      const spec = record(details.spec);
      const metrics = Array.isArray(spec.metrics) ? spec.metrics.map((metric) => text(record(metric).name)).filter(Boolean) : [];
      const groups = Array.isArray(spec.groups)
        ? spec.groups.map((group) => text(record(group).dimension)).filter(Boolean)
        : [];
      return { ...base, step: "interpretation", data: { cohort: describeFilter(spec.base), groups, metrics } };
    }
    case "code_mapping":
      return { ...base, step: "terminology", data: { mappings: mappingsOf(details) } };
    case "merge":
      return {
        ...base,
        step: "merge",
        data: { hospitals_merged: Number(details.nodes ?? 0), strategy: "Sum of partial counts, sums and sample sizes" },
      };
    case "small_cell":
      return {
        ...base,
        step: "small_cell",
        data: {
          rule: "Counts under 10 become <10. A percentage or mean based on fewer than 10 patients is suppressed.",
          cells: Array.isArray(details.suppressed) ? details.suppressed.map(smallCell) : [],
        },
      };
    case "spe":
      return { ...base, step: "spe_created", data: speData(details, text(item.node)) };
    case "download":
      return {
        ...base,
        status: "blocked",
        step: "download_attempt",
        data: {
          spe_id: requestId,
          http_status: 403,
          message: "Data cannot leave the secure processing environment (Art. 73).",
        },
      };
    default:
      return null;
  }
}

function federatedEvent(queries: Row[]): LogEvent {
  const first = queries[0];
  return {
    id: `fed-${first.id}`,
    timestamp: text(first.ts),
    duration_ms: Math.max(...queries.map((item) => Number(item.duration_ms ?? 0))),
    status: queries.some((item) => item.status === "error") ? "error" : "ok",
    step: "federated_execution",
    data: {
      hospitals: queries.map((item) => {
        const details = record(item.details);
        const error = text(details.error);
        const status = item.status === "ok" ? "ok" : error.toLowerCase().includes("timeout") ? "timeout" : "failed";
        return {
          name: text(item.node),
          status,
          query_ms: Number(item.duration_ms ?? 0),
          opted_out_excluded: Number(details.opted_out_excluded ?? 0),
          sql: text(details.sql),
        };
      }),
    },
  };
}

function classification(details: Row) {
  const branch = Number(details.branch);
  const classified =
    branch === 3 ? "access_with_justification" : branch === 4 ? "other_access" : "statistics";
  return {
    classified_as: classified as "statistics" | "access_with_justification" | "other_access",
    justification_given: branch === 3 || branch === 4,
    justification_sufficient: branch === 3 ? true : branch === 4 ? false : null,
    explanation: `Branch ${branch || "—"}`,
  };
}

function mappingsOf(details: Row) {
  const mapped = Array.isArray(details.mapped) ? details.mapped : [];
  const unknown = Array.isArray(details.unknown) ? details.unknown : [];
  return [...mapped, ...unknown].map((item) => {
    const entry = record(item);
    const kind = text(entry.kind);
    const system = kind === "icd10" ? "ICD-10" : kind === "atc" ? "ATC" : kind === "loinc" ? "LOINC" : null;
    const matches = Array.isArray(entry.matches) ? entry.matches.map(String) : [];
    return {
      term: text(entry.prefix) || text(entry.term),
      system: system as "ICD-10" | "ATC" | "LOINC" | null,
      codes: matches.length ? matches : strings(entry.prefix ? [entry.prefix] : []),
      mapped: matches.length > 0,
    };
  });
}

function smallCell(item: unknown) {
  const cell = record(item);
  const rule = text(cell.rule);
  const group = Array.isArray(cell.group) ? cell.group.map(String).join(" · ") : text(cell.group);
  return {
    group,
    metric: text(cell.metric),
    outcome: (rule.startsWith("count") ? "lt10" : "suppressed") as "lt10" | "suppressed",
    reason: rule.replaceAll("_", " "),
  };
}

function speData(details: Row, _node: string) {
  const rows = record(details.rows);
  const names = new Set<string>();
  for (const table of Object.values(rows)) {
    Object.keys(record(table)).forEach((name) => names.add(name));
  }
  return {
    schema_name: "spe",
    per_hospital: [...names].map((name) => ({
      name,
      patients: Number(record(rows.cohort)[name] ?? 0),
      records: Object.entries(rows)
        .filter(([table]) => table !== "cohort")
        .reduce((sum, [, byNode]) => sum + Number(record(byNode)[name] ?? 0), 0),
    })),
    cohort_size: Number(details.cohort_size ?? 0),
    record_types: strings(details.record_types),
  };
}

function describeFilter(value: unknown): string {
  if (!value || typeof value !== "object") return "All eligible patients";
  return JSON.stringify(value);
}

function rowPurposes(details: Row): string {
  return Array.isArray(details.allowed_purposes) ? details.allowed_purposes.join(", ") : "";
}

function articlesOf(value: unknown): number[] {
  return Array.isArray(value) ? value.map((item) => Number(item)).filter((item) => !Number.isNaN(item)) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function isMetricMap(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
