/**
 * Mock assessment engine. Stands in for the real backend until it exists.
 * Produces outcomes and log events in the exact shapes from `lib/types.ts`.
 * Suppressed raw values are computed here but never leave this module.
 */
import { ARTICLES, HOSPITALS, REGIONS } from "../constants";
import type {
  ArticleCitation,
  CellValue,
  DataRequest,
  Dimension,
  LogEvent,
  Metric,
  RequestOutcome,
  ResultRow,
  SpeResult,
  StatisticalResult,
} from "../types";

// ---------------------------------------------------------------------------
// Deterministic randomness, so the same request always gives the same numbers
// ---------------------------------------------------------------------------

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (r: () => number, min: number, max: number) => Math.round(min + r() * (max - min));

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

type Term = { term: string; system: "ICD-10" | "ATC" | "LOINC"; codes: string[] };

interface Scenario {
  title: string;
  cohort: string;
  dimensions: Dimension[];
  metrics: Metric[];
  terms: Term[];
}

const regionDim: Dimension = { key: "region", label: "Region", kind: "region", groups: REGIONS };
const hospitalDim: Dimension = {
  key: "data_holder",
  label: "Hospital",
  kind: "data_holder",
  groups: HOSPITALS,
};
const ageDim = (groups: string[]): Dimension => ({
  key: "age_band",
  label: "Age band",
  kind: "age_band",
  groups,
});

const SCENARIOS: Record<string, Scenario> = {
  R01: {
    title: "Type 2 diabetes in adults, by region",
    cohort: "Adults (18+) with type 2 diabetes",
    dimensions: [regionDim],
    metrics: [
      { key: "patients", label: "Patients", type: "count" },
      { key: "hba1c_high", label: "HbA1c above 7%", type: "percent" },
      { key: "bmi", label: "Mean BMI", type: "mean", unit: "kg/m²" },
    ],
    terms: [
      { term: "Type 2 diabetes", system: "ICD-10", codes: ["E11"] },
      { term: "HbA1c", system: "LOINC", codes: ["4548-4"] },
      { term: "BMI", system: "LOINC", codes: ["39156-5"] },
    ],
  },
  R03: {
    title: "Hypertension treatment, by age band",
    cohort: "Patients with essential hypertension",
    dimensions: [ageDim(["0–17", "18–39", "40–64", "65–79", "80+"])],
    metrics: [
      { key: "patients", label: "Patients", type: "count" },
      { key: "ace", label: "On ACE inhibitor", type: "percent" },
      { key: "sbp", label: "Mean systolic BP", type: "mean", unit: "mmHg" },
    ],
    terms: [
      { term: "Hypertension", system: "ICD-10", codes: ["I10"] },
      { term: "ACE inhibitor", system: "ATC", codes: ["C09A", "C09B"] },
      { term: "Systolic blood pressure", system: "LOINC", codes: ["8480-6"] },
    ],
  },
  R05: {
    title: "Type 2 diabetes cohort for insulin initiation research",
    cohort: "Adults with type 2 diabetes and ≥3 HbA1c values",
    dimensions: [],
    metrics: [],
    terms: [
      { term: "Type 2 diabetes", system: "ICD-10", codes: ["E11"] },
      { term: "Insulin", system: "ATC", codes: ["A10A"] },
      { term: "Oral antidiabetics", system: "ATC", codes: ["A10B"] },
      { term: "HbA1c", system: "LOINC", codes: ["4548-4"] },
    ],
  },
  R07: {
    title: "COPD patients, by hospital",
    cohort: "Patients with COPD",
    dimensions: [hospitalDim],
    metrics: [{ key: "patients", label: "Patients", type: "count" }],
    terms: [{ term: "COPD", system: "ICD-10", codes: ["J44"] }],
  },
  R08: {
    title: "Obesity and kidney function, by region",
    cohort: "Adults with BMI ≥ 30",
    dimensions: [regionDim],
    metrics: [
      { key: "patients", label: "Patients", type: "count" },
      { key: "ckd", label: "With CKD stage 3+", type: "percent" },
      { key: "egfr", label: "Mean eGFR", type: "mean", unit: "mL/min" },
    ],
    terms: [
      { term: "BMI", system: "LOINC", codes: ["39156-5"] },
      { term: "Chronic kidney disease", system: "ICD-10", codes: ["N18.3", "N18.4", "N18.5"] },
      { term: "eGFR", system: "LOINC", codes: ["33914-3"] },
    ],
  },
  R09: {
    title: "Oral anticoagulation in atrial fibrillation, by age band",
    cohort: "Patients with atrial fibrillation or flutter",
    dimensions: [ageDim(["18–64", "65–74", "75–84", "85+"])],
    metrics: [
      { key: "patients", label: "Patients", type: "count" },
      { key: "oac", label: "On oral anticoagulant", type: "percent" },
    ],
    terms: [
      { term: "Atrial fibrillation", system: "ICD-10", codes: ["I48"] },
      { term: "Oral anticoagulant", system: "ATC", codes: ["B01AF", "B01AA"] },
    ],
  },
};

const KNOWN_TERMS: Term[] = Object.values(SCENARIOS).flatMap((s) => s.terms).concat([
  { term: "Heart failure", system: "ICD-10", codes: ["I50"] },
  { term: "Smoker", system: "ICD-10", codes: ["F17", "Z72.0"] },
  { term: "Depression", system: "ICD-10", codes: ["F32", "F33"] },
  { term: "Statin", system: "ATC", codes: ["C10AA"] },
]);

const termText = (d: DataRequest["definitions"][number]) => (typeof d === "string" ? d : d.term);
const defText = (d: DataRequest["definitions"][number]) =>
  typeof d === "string" ? d : `${d.term} ${d.definition}`;

/** Fallback for requests that are not one of the examples. */
function scenarioFor(req: DataRequest): Scenario {
  const known = SCENARIOS[req.id];
  if (known) return known;

  const text = `${req.question} ${req.definitions.map(defText).join(" ")}`;
  const dims: Dimension[] = [];
  if (/region/i.test(text)) dims.push(regionDim);
  const ageDef = req.definitions.find((d) => typeof d !== "string" && /age band/i.test(d.term));
  if (ageDef && typeof ageDef !== "string") {
    const groups = ageDef.definition
      .replace(/\.$/, "")
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean);
    if (groups.length) dims.push(ageDim(groups));
  }
  if (/hospital|data.holder/i.test(text)) dims.push(hospitalDim);
  if (dims.length === 0) dims.push(regionDim);

  const terms = req.definitions
    .map(termText)
    .filter((t) => !/age band|cohort|hospital|record types/i.test(t))
    .map((t) => {
      const match = KNOWN_TERMS.find((k) => t.toLowerCase().includes(k.term.toLowerCase()));
      return match ?? ({ term: t, system: null, codes: [] } as unknown as Term);
    });

  return {
    title: req.question.length > 70 ? `${req.question.slice(0, 67)}…` : req.question,
    cohort: req.definitions.length ? termText(req.definitions[0]) : "All patients",
    dimensions: dims.slice(0, 2),
    metrics: [{ key: "patients", label: "Patients", type: "count" }],
    terms,
  };
}

// ---------------------------------------------------------------------------
// Purpose check
// ---------------------------------------------------------------------------

const PROHIBITED: Array<{ category: string; pattern: RegExp; explanation: string }> = [
  {
    category: "insurance",
    pattern: /insurance|premium/i,
    explanation: "Using health data to set insurance premiums or exclude people from cover is prohibited.",
  },
  {
    category: "marketing",
    pattern: /advertis|marketing|campaign/i,
    explanation: "Using health data for advertising or marketing to patients or professionals is prohibited.",
  },
  {
    category: "employment",
    pattern: /employ|job applicant|recruit|hiring/i,
    explanation: "Using health data for decisions about jobs or employees is prohibited.",
  },
  {
    category: "nicotine",
    pattern: /nicotine|tobacco|vap(e|our)|cigarette/i,
    explanation: "Using health data to develop harmful products such as nicotine products is prohibited.",
  },
];

// ---------------------------------------------------------------------------
// Results with the small-cell rule
// ---------------------------------------------------------------------------

type SuppressionNote = { group: string; metric: string; outcome: "lt10" | "suppressed"; reason: string };

function cartesian(dims: Dimension[]): string[][] {
  return dims.reduce<string[][]>(
    (acc, d) => acc.flatMap((prefix) => d.groups.map((g) => [...prefix, g])),
    [[]],
  );
}

function buildResult(req: DataRequest, scenario: Scenario, r: () => number) {
  const notes: SuppressionNote[] = [];
  const combos = cartesian(scenario.dimensions);
  // Guarantee at least one empty and one small group, so the rule is visible.
  const emptyIndex = between(r, 0, combos.length - 1);
  const smallIndex = (emptyIndex + 3) % combos.length;

  const rows: ResultRow[] = combos.map((group, i) => {
    let n = between(r, 40, scenario.dimensions.length > 1 ? 260 : 900);
    const large = combos.length > 5;
    if (large && i === emptyIndex) n = 0;
    else if (large && i === smallIndex) n = between(r, 2, 9);
    else if (large && r() < 0.08) n = between(r, 1, 9);
    else if (!large && i === emptyIndex && /0–17|85\+/.test(group.join())) n = between(r, 2, 9);

    const label = group.join(" · ");
    const values: Record<string, CellValue> = {};

    for (const m of scenario.metrics) {
      if (m.type === "count") {
        if (n < 10) {
          values[m.key] = { kind: "lt10" };
          notes.push({ group: label, metric: m.label, outcome: "lt10", reason: n === 0 ? "No patients in this group (0–9 shown as <10)" : "Count between 1 and 9" });
        } else values[m.key] = { kind: "value", value: n };
      } else if (m.type === "percent") {
        const numerator = Math.round(n * (0.15 + r() * 0.6));
        if (n < 10) {
          values[m.key] = { kind: "suppressed" };
          notes.push({ group: label, metric: m.label, outcome: "suppressed", reason: "Denominator below 10" });
        } else if (numerator < 10) {
          values[m.key] = { kind: "suppressed" };
          notes.push({ group: label, metric: m.label, outcome: "suppressed", reason: "Numerator below 10 — percentage would reveal a small count" });
        } else values[m.key] = { kind: "value", value: Math.round((numerator / n) * 1000) / 10 };
      } else {
        if (n < 10) {
          values[m.key] = { kind: "suppressed" };
          notes.push({ group: label, metric: m.label, outcome: "suppressed", reason: "Mean based on fewer than 10 patients" });
        } else {
          const base = m.unit === "mmHg" ? 128 : m.unit === "mL/min" ? 68 : 29;
          values[m.key] = { kind: "value", value: Math.round((base + (r() - 0.5) * base * 0.2) * 10) / 10 };
        }
      }
    }
    return { group, values };
  });

  const result: StatisticalResult = {
    title: scenario.title,
    description: scenario.cohort,
    dimensions: scenario.dimensions,
    metrics: scenario.metrics,
    rows,
  };
  return { result, notes };
}

function sqlFor(scenario: Scenario, hospital: string) {
  const schema = hospital.toLowerCase().replace("ü", "ue").replace(/\s+/g, "_");
  const codes = scenario.terms.flatMap((t) => t.codes.map((c) => `'${c}%'`));
  const groupBy = scenario.dimensions.map((d) => (d.kind === "age_band" ? "age_band(p.birth_date)" : d.kind === "data_holder" ? "p.data_holder" : "p.region"));
  return [
    `-- ${hospital}: returns sums and counts only, merged centrally`,
    `SELECT ${[...groupBy, "COUNT(DISTINCT p.patient_id) AS n", "SUM(o.value) AS value_sum", "COUNT(o.value) AS value_n"].join(",\n       ")}`,
    `FROM ${schema}.patients p`,
    `JOIN ${schema}.conditions c ON c.patient_id = p.patient_id`,
    `LEFT JOIN ${schema}.observations o ON o.patient_id = p.patient_id`,
    `WHERE p.opted_out = FALSE`,
    codes.length ? `  AND (c.code LIKE ${codes.slice(0, 3).join(" OR c.code LIKE ")})` : `  AND TRUE`,
    groupBy.length ? `GROUP BY ${groupBy.join(", ")};` : ";",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export interface MockRun {
  outcome: RequestOutcome;
  log: LogEvent[];
  failed: boolean;
}

export function assess(req: DataRequest & { simulate_failure?: string }, submittedAt: Date): MockRun {
  const r = rng(hash(req.id + req.purpose));
  const scenario = scenarioFor(req);
  const log: LogEvent[] = [];
  let clock = submittedAt.getTime();
  let seq = 0;

  const push = (event: Omit<LogEvent, "id" | "timestamp">) => {
    log.push({ ...event, id: `${req.id}-${++seq}`, timestamp: new Date(clock).toISOString() } as LogEvent);
    clock += event.duration_ms;
  };

  const cite = (n: number, explanation?: string): ArticleCitation => ({
    article: n,
    explanation: explanation ?? ARTICLES[n]?.explanation ?? "",
  });

  push({ step: "received", status: "ok", duration_ms: between(r, 8, 30), data: { valid: true, schema_errors: [] } });

  // 1. Purpose
  const text = `${req.purpose} ${req.question}`;
  const prohibited = PROHIBITED.find((p) => p.pattern.test(text));
  push({
    step: "purpose_check",
    status: prohibited ? "error" : "ok",
    duration_ms: between(r, 400, 1400),
    data: {
      allowed: !prohibited,
      prohibited_category: prohibited?.category ?? null,
      article: prohibited ? 54 : 53,
      explanation: prohibited ? prohibited.explanation : "The purpose is scientific research, public health or health-system planning, which the law permits.",
    },
  });

  if (prohibited) {
    const articles = [cite(54, `Art. 54: ${prohibited.explanation.replace(/\.$/, "")}.`)];
    push({ step: "decision", status: "error", duration_ms: between(r, 5, 20), data: { decision: "REJECT", articles: [54] } });
    return {
      failed: false,
      log,
      outcome: {
        request_id: req.id,
        decision: "REJECT",
        requested_as: req.requested_as,
        granted_as: "none",
        reason: `Your request is rejected because its purpose falls under a prohibited use (${prohibited.category}). ${prohibited.explanation} No data is released.`,
        articles,
        results: null,
        spe: null,
        federation: null,
        processing_ms: clock - submittedAt.getTime(),
      },
    };
  }

  // 2. Classification
  const justification = req.justification?.trim() ?? "";
  const justified = req.requested_as === "records" && justification.length > 120;
  const grantedAs = justified ? "records" : "statistics";
  push({
    step: "classification",
    status: req.requested_as === "records" && !justified ? "warning" : "ok",
    duration_ms: between(r, 300, 900),
    data: {
      classified_as:
        req.requested_as === "statistics" ? "statistics" : justified ? "access_with_justification" : "other_access",
      justification_given: justification.length > 0,
      justification_sufficient: req.requested_as === "records" ? justified : null,
      explanation:
        req.requested_as === "statistics"
          ? "The applicant asks for aggregated statistics."
          : justified
            ? "Records requested with a justification that explains why statistics cannot answer the question."
            : "Records requested, but the question can be answered with statistics. Downgraded to a statistical answer.",
    },
  });

  // 3. Interpretation
  push({
    step: "interpretation",
    status: "ok",
    duration_ms: between(r, 600, 1800),
    data: {
      cohort: scenario.cohort,
      groups: scenario.dimensions.map((d) => `${d.label} (${d.groups.length})`),
      metrics: justified ? ["Record extract: conditions, medications, HbA1c"] : scenario.metrics.map((m) => `${m.label} (${m.type})`),
    },
  });

  // 4. Terminology
  push({
    step: "terminology",
    status: scenario.terms.some((t) => !t.system) ? "warning" : "ok",
    duration_ms: between(r, 200, 700),
    data: {
      mappings: scenario.terms.map((t) => ({ term: t.term, system: t.system ?? null, codes: t.codes, mapped: !!t.system })),
    },
  });

  // 5. Federated execution
  const failing = HOSPITALS.find((h) => h === req.simulate_failure);
  const hospitals = HOSPITALS.map((name) => ({
    name,
    status: name === failing ? ("timeout" as const) : ("ok" as const),
    query_ms: name === failing ? 30000 : between(r, 250, 1600),
    opted_out_excluded: name === failing ? 0 : between(r, 12, 64),
    sql: sqlFor(scenario, name),
  }));
  push({
    step: "federated_execution",
    status: failing ? "error" : "ok",
    duration_ms: Math.max(...hospitals.map((h) => Math.min(h.query_ms, 3000))),
    data: { hospitals },
  });

  const federation = {
    status: failing ? ("failed" as const) : ("complete" as const),
    hospitals: hospitals.map((h) => ({ name: h.name, status: h.status })),
  };

  if (failing) {
    const articles = [cite(69)];
    return {
      failed: true,
      log,
      outcome: {
        request_id: req.id,
        decision: grantedAs === "records" ? "APPROVE_SPE" : "APPROVE_STATISTICAL",
        requested_as: req.requested_as,
        granted_as: grantedAs,
        reason: `Your request was approved, but ${failing} did not respond in time. To avoid giving you incomplete numbers, no results are released. Please submit the request again later.`,
        articles,
        results: null,
        spe: null,
        federation,
        processing_ms: clock - submittedAt.getTime(),
      },
    };
  }

  // 6a. SPE
  if (grantedAs === "records") {
    const total = req.id === "R05" ? 1152 : between(r, 300, 2400);
    const split = [0.43, 0.35];
    const perHospital = HOSPITALS.map((name, i) => {
      const patients = i < 2 ? Math.round(total * split[i]) : total - Math.round(total * split[0]) - Math.round(total * split[1]);
      return { name, patients, records: patients * between(r, 28, 46) };
    });
    const speId = `SPE-${req.id}-${(hash(req.id) % 9000) + 1000}`;
    const schema = `spe_${req.id.toLowerCase()}_${(hash(req.id) % 9000) + 1000}`;
    push({ step: "merge", status: "ok", duration_ms: between(r, 100, 300), data: { hospitals_merged: 3, strategy: "Union of pseudonymised patient records, de-duplicated by patient" } });
    const recordTypes = ["Conditions", "Medications", "HbA1c observations"];
    push({
      step: "spe_created",
      status: "ok",
      duration_ms: between(r, 800, 1600),
      data: { schema_name: schema, per_hospital: perHospital, cohort_size: total, record_types: recordTypes },
    });
    const articles = [cite(68, "A data permit is granted because the justification explains why statistics are not enough."), cite(73)];
    push({ step: "decision", status: "ok", duration_ms: between(r, 5, 20), data: { decision: "APPROVE_SPE", articles: [68, 73] } });
    const spe: SpeResult = {
      spe_id: speId,
      schema_name: schema,
      cohort_size: total,
      record_types: recordTypes,
      created_at: new Date(clock).toISOString(),
      expires_at: new Date(clock + 1000 * 60 * 60 * 24 * 90).toISOString(),
    };
    return {
      failed: false,
      log,
      outcome: {
        request_id: req.id,
        decision: "APPROVE_SPE",
        requested_as: req.requested_as,
        granted_as: "records",
        reason: "Your research needs individual-level sequences that statistics cannot provide, so you get access to pseudonymised records inside a secure processing environment. You can analyse the data there, but you cannot download it.",
        articles,
        results: null,
        spe,
        federation,
        processing_ms: clock - submittedAt.getTime(),
      },
    };
  }

  // 6b. Statistics
  push({ step: "merge", status: "ok", duration_ms: between(r, 60, 240), data: { hospitals_merged: 3, strategy: "Sum counts and value sums per group, then compute percentages and means" } });
  const { result, notes } = buildResult(req, scenario, r);
  push({
    step: "small_cell",
    status: notes.length ? "warning" : "ok",
    duration_ms: between(r, 20, 80),
    data: { rule: "Counts 0–9 shown as <10; percentages and means based on fewer than 10 patients are suppressed; values rounded to one decimal. Applied after merging.", cells: notes },
  });

  const downgraded = req.requested_as === "records";
  const articleNums = downgraded ? [66, 69] : [53, 69];
  const articles = downgraded
    ? [cite(66, "Statistics are enough to answer your question, so no records are released."), cite(69)]
    : [cite(53, "Your purpose is permitted."), cite(69)];
  push({ step: "decision", status: "ok", duration_ms: between(r, 5, 20), data: { decision: "APPROVE_STATISTICAL", articles: articleNums } });

  return {
    failed: false,
    log,
    outcome: {
      request_id: req.id,
      decision: "APPROVE_STATISTICAL",
      requested_as: req.requested_as,
      granted_as: "statistics",
      reason: downgraded
        ? "Your question asks for shares per group, which anonymised statistics answer completely. The law requires us to release the least identifying data that works, so you receive statistics instead of records."
        : "Your purpose is permitted and your question can be answered with anonymised statistics. Small groups are hidden to protect patients.",
      articles,
      results: [result],
      spe: null,
      federation,
      processing_ms: clock - submittedAt.getTime(),
    },
  };
}
