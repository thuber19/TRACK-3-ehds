"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowLeftIcon, RotateCcwIcon, SendIcon, TriangleAlertIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { OutcomeView } from "@/components/request/outcome-view";
import { RequestSummary } from "@/components/request/request-summary";
import { ApiError, api } from "@/lib/api";
import type { DataRequest, RequestOutcome } from "@/lib/types";
import { requestKind } from "@/lib/constants";
import { validateRequestText } from "@/lib/validate";

import { ProcessingPanel } from "./processing-panel";
import { RequestComposer } from "./request-composer";
import { ValidationStatus } from "./validation-status";

type Phase =
  | { kind: "compose" }
  | { kind: "processing"; request: DataRequest; startedAt: number }
  | { kind: "done"; request: DataRequest; outcome: RequestOutcome }
  | { kind: "error"; request: DataRequest; message: string };

export function ApplicantWorkspace() {
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "compose" });
  const abort = useRef<AbortController | null>(null);
  const validation = useMemo(() => validateRequestText(text), [text]);

  async function submit() {
    if (!validation.ok) return;
    const request = validation.request;
    abort.current = new AbortController();
    setPhase({ kind: "processing", request, startedAt: Date.now() });
    try {
      const outcome = await api.submitRequest(request, abort.current.signal);
      setPhase({ kind: "done", request, outcome });
    } catch (error) {
      if ((error as Error).name === "AbortError") return setPhase({ kind: "compose" });
      const message =
        error instanceof ApiError ? `The server answered with ${error.status}: ${error.message}` : "The server could not be reached.";
      setPhase({ kind: "error", request, message });
    }
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {phase.kind === "compose" ? "Submit a data request" : phase.kind === "processing" ? "Processing" : "Your result"}
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            {phase.kind === "compose"
              ? "Ask a question about health data from Klinikum Nord, Süd and West. We check the purpose, decide what you may receive, and answer within a minute."
              : "Every decision is based on the European Health Data Space rules and logged for review."}
          </p>
        </div>
        {(phase.kind === "done" || phase.kind === "error") && (
          <Button variant="outline" onClick={() => setPhase({ kind: "compose" })}>
            <ArrowLeftIcon />
            New request
          </Button>
        )}
        {phase.kind === "processing" && (
          <Button variant="ghost" onClick={() => abort.current?.abort()}>
            Cancel
          </Button>
        )}
      </div>

      {phase.kind === "compose" && (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Card>
            <CardHeader>
              <CardTitle>Request</CardTitle>
              <CardDescription>Choose how you want to provide the request JSON.</CardDescription>
            </CardHeader>
            <CardContent>
              <RequestComposer text={text} onTextChange={setText} invalid={!validation.ok && validation.kind !== "empty"} />
            </CardContent>
          </Card>

          <Card className="lg:sticky lg:top-20">
            <CardHeader>
              <CardTitle>Check &amp; send</CardTitle>
              <CardDescription>We validate the request before it is sent.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <ValidationStatus result={validation} />
              {validation.ok && (
                <dl className="grid gap-2 text-sm">
                  <Row label="ID" value={validation.request.id} mono />
                  <Row label="Applicant" value={validation.request.applicant.name} />
                  <Row label="Organisation" value={validation.request.applicant.organisation} />
                  <Row label="Asks for" value={requestKind(validation.request.requested_as) === "records" ? "Access to records" : "Statistics"} />
                  <Row label="Definitions" value={String(validation.request.definitions.length)} />
                </dl>
              )}
            </CardContent>
            <CardFooter className="border-t bg-muted/40 py-4">
              <Button size="lg" className="w-full" disabled={!validation.ok} onClick={submit}>
                <SendIcon />
                Submit request
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}

      {phase.kind === "processing" && <ProcessingPanel startedAt={phase.startedAt} requestId={phase.request.id} />}

      {phase.kind === "error" && (
        <Alert variant="destructive" className="mx-auto max-w-xl">
          <TriangleAlertIcon />
          <AlertTitle>Your request could not be processed</AlertTitle>
          <AlertDescription className="grid gap-3">
            <span>{phase.message}</span>
            <Button variant="outline" size="sm" className="w-fit" onClick={submit}>
              <RotateCcwIcon />
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {phase.kind === "done" && (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <OutcomeView outcome={phase.outcome} />
          <div className="lg:sticky lg:top-20">
            <RequestSummary request={phase.request} />
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "truncate font-mono font-medium" : "truncate text-right font-medium"}>{value}</dd>
    </div>
  );
}
