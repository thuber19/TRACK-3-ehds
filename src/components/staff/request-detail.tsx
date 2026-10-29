"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeftIcon, CopyIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DecisionBadge } from "@/components/request/decision-badge";
import { OutcomeView, formatDuration } from "@/components/request/outcome-view";
import { RequestSummary } from "@/components/request/request-summary";
import { ApiError, api } from "@/lib/api";
import { REQUESTED_AS_LABEL } from "@/lib/constants";
import type { RequestDetail } from "@/lib/types";

import { fmtDateTime } from "./format";
import { StatusPill } from "./request-list";
import { Timeline } from "./timeline";

export function RequestDetailView({ id }: { id: string }) {
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .getRequest(id)
      .then((data) => {
        setDetail(data);
        setError(null);
      })
      .catch((e) =>
        setError(e instanceof ApiError && e.status === 404 ? `Request ${id} was not found.` : "Could not load this request."),
      );
  }, [id]);

  useEffect(load, [load]);

  const json = detail ? JSON.stringify(detail.request, null, 2) : "";
  const downloads = detail?.log.filter((e) => e.step === "download_attempt").length ?? 0;

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2" render={<Link href="/staff" />} nativeButton={false}>
          <ArrowLeftIcon />
          All requests
        </Button>
      </div>

      {error && <p className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">{error}</p>}

      {!detail && !error && (
        <div className="grid gap-4">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-96 w-full" />
        </div>
      )}

      {detail && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-mono text-2xl font-semibold tracking-tight sm:text-3xl">{id}</h1>
                {detail.outcome && <DecisionBadge decision={detail.outcome.decision} />}
                <StatusPill status={detail.status} />
              </div>
              <p className="text-muted-foreground">
                {detail.request.applicant.name} · {detail.request.applicant.organisation} · {REQUESTED_AS_LABEL[detail.request.requested_as]}
              </p>
            </div>
            <Button variant="outline" onClick={load}>
              <RefreshCwIcon />
              Refresh log
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Submitted" value={fmtDateTime(detail.submitted_at)} />
            <Metric label="Processing time" value={detail.outcome ? formatDuration(detail.outcome.processing_ms) : "—"} />
            <Metric label="Log events" value={String(detail.log.length)} />
            <Metric label="Blocked downloads" value={String(downloads)} highlight={downloads > 0} />
          </div>

          <Tabs defaultValue="timeline" className="gap-4">
            <TabsList>
              <TabsTrigger value="timeline" className="px-3">Timeline</TabsTrigger>
              <TabsTrigger value="applicant" className="px-3">What the applicant saw</TabsTrigger>
              <TabsTrigger value="json" className="px-3">Original JSON</TabsTrigger>
            </TabsList>

            <TabsContent value="timeline">
              <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <Card>
                  <CardHeader className="border-b">
                    <CardTitle>What happened</CardTitle>
                    <CardDescription>Each step with its timestamp and duration. Suppressed raw values are never shown.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Timeline log={detail.log} />
                  </CardContent>
                </Card>
                <div className="lg:sticky lg:top-20">
                  <RequestSummary request={detail.request} />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="applicant">
              {detail.outcome ? (
                <div className="rounded-2xl border border-dashed bg-background/50 p-4 sm:p-6">
                  <p className="mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">Exactly as shown to the applicant</p>
                  <OutcomeView outcome={detail.outcome} interactive={false} />
                </div>
              ) : (
                <p className="text-muted-foreground">No outcome yet.</p>
              )}
            </TabsContent>

            <TabsContent value="json">
              <Card>
                <CardHeader className="border-b">
                  <CardTitle>Original request</CardTitle>
                  <CardDescription>As submitted by the applicant.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="relative">
                    <Button
                      variant="outline"
                      size="sm"
                      className="absolute top-2 right-2"
                      onClick={() => navigator.clipboard.writeText(json).then(() => toast.success("JSON copied"))}
                    >
                      <CopyIcon />
                      Copy
                    </Button>
                    <pre className="max-h-[36rem] overflow-auto rounded-lg bg-muted/50 p-4 font-mono text-xs leading-relaxed">{json}</pre>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={highlight ? "mt-1 text-xl font-semibold text-destructive tabular-nums" : "mt-1 text-xl font-semibold tabular-nums"}>{value}</p>
    </div>
  );
}
