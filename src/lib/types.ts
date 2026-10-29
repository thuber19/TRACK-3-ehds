/**
 * Shared contract between the frontend and the backend.
 * The backend (POST /requests, GET /requests, GET /requests/{id},
 * POST /spe/{id}/download) should return exactly these shapes.
 */

// ---------------------------------------------------------------------------
// Request (what the applicant submits)
// ---------------------------------------------------------------------------

export type RequestedAs = "statistics" | "records";

export interface Applicant {
  name: string;
  organisation: string;
  country: string;
}

export interface Definition {
  term: string;
  definition: string;
}

export interface DataRequest {
  id: string;
  applicant: Applicant;
  requested_as: RequestedAs;
  requested_format: string;
  purpose: string;
  question: string;
  /** Strings are accepted too; they are shown as-is. */
  definitions: Array<Definition | string>;
  /** Free-text justification for why statistics are not enough (records requests). */
  justification?: string;
}

// ---------------------------------------------------------------------------
// Decision + results (what the applicant sees)
// ---------------------------------------------------------------------------

export type Decision = "REJECT" | "APPROVE_STATISTICAL" | "APPROVE_SPE";

export type ArticleNumber = 53 | 54 | 66 | 68 | 69 | 73;

export interface ArticleCitation {
  article: ArticleNumber | number;
  /** One-line plain-language explanation, e.g. "This purpose is prohibited". */
  explanation: string;
}

/** A single cell after the small-cell rule has been applied. */
export type CellValue =
  | { kind: "value"; value: number }
  | { kind: "lt10" }
  | { kind: "suppressed" };

export type MetricType = "count" | "percent" | "mean";

export interface Metric {
  key: string;
  label: string;
  type: MetricType;
  /** Optional unit for means, e.g. "kg/m²" or "%". */
  unit?: string;
}

export type DimensionKind = "region" | "age_band" | "data_holder" | "sex" | "other";

export interface Dimension {
  key: string;
  label: string;
  kind: DimensionKind;
  /** Every requested group, in display order — including empty ones. */
  groups: string[];
}

export interface ResultRow {
  /** One group label per dimension, in the same order as `dimensions`. */
  group: string[];
  values: Record<string, CellValue>;
}

export interface StatisticalResult {
  title: string;
  description?: string;
  /** One dimension → grouped table; two dimensions → cross-table. */
  dimensions: Dimension[];
  metrics: Metric[];
  rows: ResultRow[];
}

export interface SpeResult {
  spe_id: string;
  schema_name: string;
  cohort_size: number;
  record_types: string[];
  created_at: string;
  expires_at?: string;
}

export type HospitalStatus = "ok" | "failed" | "timeout";

export interface FederationSummary {
  /** "failed" means at least one hospital did not answer — no results are released. */
  status: "complete" | "failed";
  hospitals: Array<{ name: string; status: HospitalStatus }>;
}

export interface RequestOutcome {
  request_id: string;
  decision: Decision;
  /** What the applicant asked for vs. what they were granted (R09). */
  requested_as: RequestedAs;
  granted_as: "statistics" | "records" | "none";
  reason: string;
  articles: ArticleCitation[];
  results: StatisticalResult[] | null;
  spe: SpeResult | null;
  federation: FederationSummary | null;
  processing_ms: number;
}

// ---------------------------------------------------------------------------
// Staff list + detail
// ---------------------------------------------------------------------------

export type RequestStatus = "processing" | "completed" | "failed";

export interface RequestListItem {
  id: string;
  applicant_name: string;
  organisation: string;
  requested_as: RequestedAs;
  purpose: string;
  decision: Decision | null;
  articles: number[];
  submitted_at: string;
  processing_ms: number | null;
  status: RequestStatus;
}

export type LogStatus = "ok" | "warning" | "error" | "info" | "blocked";

interface LogBase {
  id: string;
  timestamp: string;
  duration_ms: number;
  status: LogStatus;
}

export type LogEvent = LogBase &
  (
    | {
        step: "received";
        data: { valid: boolean; schema_errors: string[] };
      }
    | {
        step: "purpose_check";
        data: {
          allowed: boolean;
          /** insurance | marketing | employment | nicotine */
          prohibited_category: string | null;
          article: number | null;
          explanation: string;
        };
      }
    | {
        step: "classification";
        data: {
          classified_as: "statistics" | "access_with_justification" | "other_access";
          justification_given: boolean;
          justification_sufficient: boolean | null;
          explanation: string;
        };
      }
    | {
        step: "interpretation";
        data: {
          cohort: string;
          groups: string[];
          metrics: string[];
        };
      }
    | {
        step: "terminology";
        data: {
          mappings: Array<{
            term: string;
            system: "ICD-10" | "ATC" | "LOINC" | null;
            codes: string[];
            mapped: boolean;
          }>;
        };
      }
    | {
        step: "federated_execution";
        data: {
          hospitals: Array<{
            name: string;
            status: HospitalStatus;
            query_ms: number;
            opted_out_excluded: number;
            sql: string;
          }>;
        };
      }
    | {
        step: "merge";
        data: { hospitals_merged: number; strategy: string };
      }
    | {
        step: "small_cell";
        data: {
          rule: string;
          cells: Array<{
            group: string;
            metric: string;
            outcome: "lt10" | "suppressed";
            reason: string;
          }>;
        };
      }
    | {
        step: "spe_created";
        data: {
          schema_name: string;
          per_hospital: Array<{ name: string; patients: number; records: number }>;
          cohort_size: number;
          record_types: string[];
        };
      }
    | {
        step: "download_attempt";
        data: { spe_id: string; http_status: 403; message: string };
      }
    | {
        step: "decision";
        data: { decision: Decision; articles: number[] };
      }
  );

export type LogStep = LogEvent["step"];

export interface RequestDetail {
  request: DataRequest;
  outcome: RequestOutcome | null;
  status: RequestStatus;
  submitted_at: string;
  log: LogEvent[];
}
