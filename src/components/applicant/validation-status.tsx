import { CheckCircle2Icon, CircleDashedIcon, XCircleIcon } from "lucide-react";

import type { ValidationResult } from "@/lib/validate";

export function ValidationStatus({ result }: { result: ValidationResult }) {
  if (!result.ok && result.kind === "empty") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        <CircleDashedIcon className="size-4" />
        Pick an example, paste JSON or upload a file to begin.
      </div>
    );
  }

  if (result.ok) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm font-medium text-success">
        <CheckCircle2Icon className="size-4" />
        Valid request — all required fields are present.
      </div>
    );
  }

  return (
    <div className="grid gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
      <p className="flex items-center gap-2 font-medium text-destructive">
        <XCircleIcon className="size-4" />
        {result.kind === "syntax" ? "This is not valid JSON" : `${result.issues.length} problem${result.issues.length === 1 ? "" : "s"} to fix before sending`}
      </p>
      <ul className="grid gap-1 pl-6">
        {result.issues.map((issue, i) => (
          <li key={i} className="text-destructive/90">
            <code className="rounded bg-destructive/10 px-1 py-px font-mono text-xs">{issue.path}</code> {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
