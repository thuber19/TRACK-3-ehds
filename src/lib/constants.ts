import type { Decision } from "./types";

export const REGIONS = [
  "Burgenland",
  "Kärnten",
  "Niederösterreich",
  "Oberösterreich",
  "Salzburg",
  "Steiermark",
  "Tirol",
  "Vorarlberg",
  "Wien",
];

export const HOSPITALS = ["Klinikum Nord", "Klinikum Süd", "Klinikum West"];

/** Default one-line explanations, used when the backend sends none. */
export const ARTICLES: Record<number, { title: string; explanation: string }> = {
  53: {
    title: "Permitted purposes",
    explanation: "The purpose is one of the uses the law allows.",
  },
  54: {
    title: "Prohibited purposes",
    explanation: "This purpose is prohibited.",
  },
  66: {
    title: "Data minimisation",
    explanation: "Only the least identifying data that answers the question is released.",
  },
  68: {
    title: "Data permit",
    explanation: "Access to records needs a permit and a solid justification.",
  },
  69: {
    title: "Statistical data request",
    explanation: "The answer is given as anonymised statistics.",
  },
  73: {
    title: "Secure processing environment",
    explanation: "Data can only be used inside the secure environment and cannot leave it.",
  },
};

export const DECISION_META: Record<
  Decision,
  { label: string; short: string; tone: "destructive" | "success" | "info" }
> = {
  REJECT: { label: "Rejected", short: "Rejected", tone: "destructive" },
  APPROVE_STATISTICAL: {
    label: "Approved (statistics)",
    short: "Statistics",
    tone: "success",
  },
  APPROVE_SPE: {
    label: "Approved (secure environment)",
    short: "Secure env.",
    tone: "info",
  },
};

export const REQUESTED_AS_LABEL = {
  statistics: "Statistics",
  records: "Access to records",
} as const;

/** Official files say "health data request" / "health data access application". */
export function requestKind(value: string | undefined | null): "statistics" | "records" {
  const text = (value ?? "").toLowerCase();
  if (text === "records" || text.includes("access")) return "records";
  return "statistics";
}

export function requestKindLabel(value: string | undefined | null) {
  return REQUESTED_AS_LABEL[requestKind(value)];
}

export const TARGET_SECONDS = 60;
