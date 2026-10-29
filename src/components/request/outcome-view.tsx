import { ArrowRightIcon, CircleAlertIcon, ServerCrashIcon, ShieldOffIcon, TimerIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { REQUESTED_AS_LABEL } from "@/lib/constants";
import type { RequestOutcome } from "@/lib/types";
import { cn } from "@/lib/utils";

import { ArticleList } from "./article-chips";
import { CellLegend } from "./cell";
import { DecisionBadge } from "./decision-badge";
import { ResultTable } from "./result-table";
import { SpePanel } from "./spe-panel";

const ACCENT = {
  REJECT: "from-destructive/10",
  APPROVE_STATISTICAL: "from-success/10",
  APPROVE_SPE: "from-info/10",
} as const;

export function formatDuration(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function OutcomeView({ outcome, interactive = true }: { outcome: RequestOutcome; interactive?: boolean }) {
  const downgraded = outcome.requested_as === "records" && outcome.granted_as === "statistics";
  const failedHospitals = outcome.federation?.hospitals.filter((h) => h.status !== "ok") ?? [];
  const federationFailed = outcome.federation?.status === "failed";

  return (
    <div className="grid gap-6">
      <Card className={cn("bg-linear-to-br to-card to-60%", ACCENT[outcome.decision])}>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardDescription>Decision for {outcome.request_id}</CardDescription>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <TimerIcon className="size-3.5" />
              Processed in {formatDuration(outcome.processing_ms)}
            </span>
          </div>
          <div className="pt-2">
            <DecisionBadge decision={outcome.decision} size="lg" />
          </div>
        </CardHeader>
        <CardContent className="grid gap-5">
          <p className="max-w-3xl text-base leading-relaxed text-pretty">{outcome.reason}</p>

          {downgraded && (
            <div className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm sm:flex-row sm:items-center">
              <div className="flex shrink-0 items-center gap-2 font-medium whitespace-nowrap">
                <span className="rounded-md bg-background px-2 py-0.5 ring-1 ring-border">{REQUESTED_AS_LABEL.records}</span>
                <ArrowRightIcon className="size-4 text-muted-foreground" />
                <span className="rounded-md bg-background px-2 py-0.5 ring-1 ring-border">{REQUESTED_AS_LABEL.statistics}</span>
              </div>
              <p>You asked for records; statistics are enough for your question, so you receive statistics.</p>
            </div>
          )}

          <div className="grid gap-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Legal basis</p>
            <ArticleList articles={outcome.articles} />
          </div>
        </CardContent>
      </Card>

      {federationFailed && (
        <Alert variant="destructive">
          <ServerCrashIcon />
          <AlertTitle>No results released — {failedHospitals.map((h) => h.name).join(", ")} unavailable</AlertTitle>
          <AlertDescription>
            The query runs on three hospital databases. One did not answer, so the numbers would be incomplete. To avoid
            misleading results, nothing is shown. Please submit the request again later.
          </AlertDescription>
        </Alert>
      )}

      {outcome.decision === "REJECT" && (
        <div className="flex items-center gap-3 rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
          <ShieldOffIcon className="size-5 shrink-0" />
          No data is released for rejected requests.
        </div>
      )}

      {outcome.results?.map((result, i) => (
        <Card key={i}>
          <CardHeader className="border-b">
            <CardTitle>{result.title}</CardTitle>
            {result.description && <CardDescription>Cohort: {result.description}</CardDescription>}
          </CardHeader>
          <CardContent className="grid gap-4">
            <ResultTable result={result} />
            <div className="flex items-start gap-2 rounded-lg bg-muted/60 p-3">
              <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <CellLegend />
            </div>
          </CardContent>
        </Card>
      ))}

      {outcome.spe && (
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Secure processing environment</CardTitle>
            <CardDescription>Your pseudonymised cohort is ready inside the secure environment.</CardDescription>
          </CardHeader>
          <CardContent>
            <SpePanel spe={outcome.spe} interactive={interactive} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
