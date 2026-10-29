import type { DataRequest } from "./types";

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; request: DataRequest }
  | { ok: false; kind: "empty" | "syntax" | "schema"; issues: ValidationIssue[] };

function lineAndColumn(text: string, position: number) {
  const before = text.slice(0, position);
  const line = before.split("\n").length;
  const column = position - before.lastIndexOf("\n");
  return { line, column };
}

function syntaxIssue(text: string, error: unknown): ValidationIssue {
  const message = error instanceof Error ? error.message : String(error);
  const match = /position (\d+)/i.exec(message);
  if (match) {
    const { line, column } = lineAndColumn(text, Number(match[1]));
    return { path: `line ${line}, column ${column}`, message: cleanSyntaxMessage(message) };
  }
  return { path: "JSON", message: cleanSyntaxMessage(message) };
}

function cleanSyntaxMessage(message: string) {
  return message.replace(/\s*\(line \d+ column \d+\)/i, "").replace(/ in JSON at position \d+/i, "");
}

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export function validateRequestText(text: string): ValidationResult {
  if (!text.trim()) {
    return { ok: false, kind: "empty", issues: [] };
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { ok: false, kind: "syntax", issues: [syntaxIssue(text, error)] };
  }

  const issues: ValidationIssue[] = [];

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return {
      ok: false,
      kind: "schema",
      issues: [{ path: "(root)", message: "The request must be a JSON object." }],
    };
  }

  const obj = data as Record<string, unknown>;

  if (!isNonEmptyString(obj.id)) issues.push({ path: "id", message: "Required text field is missing." });

  const applicant = obj.applicant as Record<string, unknown> | undefined;
  if (typeof applicant !== "object" || applicant === null || Array.isArray(applicant)) {
    issues.push({ path: "applicant", message: "Must be an object with name, organisation and country." });
  } else {
    for (const field of ["name", "organisation", "country"] as const) {
      if (!isNonEmptyString(applicant[field])) {
        issues.push({ path: `applicant.${field}`, message: "Required text field is missing." });
      }
    }
  }

  if (obj.requested_as !== "statistics" && obj.requested_as !== "records") {
    issues.push({
      path: "requested_as",
      message: obj.requested_as === undefined ? "Required field is missing." : 'Must be "statistics" or "records".',
    });
  }

  for (const field of ["requested_format", "purpose", "question"] as const) {
    if (!isNonEmptyString(obj[field])) issues.push({ path: field, message: "Required text field is missing." });
  }

  if (!Array.isArray(obj.definitions)) {
    issues.push({ path: "definitions", message: "Must be a list (it may be empty)." });
  } else {
    obj.definitions.forEach((d, i) => {
      if (typeof d === "string") return;
      if (typeof d !== "object" || d === null || !isNonEmptyString((d as Record<string, unknown>).term)) {
        issues.push({
          path: `definitions[${i}]`,
          message: 'Each definition needs a "term" and a "definition" (or a plain string).',
        });
      }
    });
  }

  if (issues.length > 0) return { ok: false, kind: "schema", issues };
  return { ok: true, request: obj as unknown as DataRequest };
}
