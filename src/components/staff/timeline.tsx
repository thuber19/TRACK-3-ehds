"use client";

import {
  BanIcon,
  BrainIcon,
  ChevronRightIcon,
  CombineIcon,
  DatabaseZapIcon,
  EyeOffIcon,
  GavelIcon,
  InboxIcon,
  LanguagesIcon,
  LockIcon,
  ServerIcon,
  ShieldCheckIcon,
  SplitIcon,
} from "lucide-react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DecisionBadge } from "@/components/request/decision-badge";
import { formatDuration } from "@/components/request/outcome-view";
import type { LogEvent, LogStatus, LogStep } from "@/lib/types";
import { cn } from "@/lib/utils";

import { fmtTimePrecise } from "./format";

const STEP_META: Record<LogStep, { title: string; icon: React.ComponentType<{ className?: string }> }> = {
  received: { title: "Request received and validated", icon: InboxIcon },
  purpose_check: { title: "Purpose check", icon: ShieldCheckIcon },
  classification: { title: "Request type classified", icon: SplitIcon },
  interpretation: { title: "Definitions interpreted into a query spec", icon: BrainIcon },
  terminology: { title: "Codes resolved", icon: LanguagesIcon },
  federated_execution: { title: "Federated execution", icon: ServerIcon },
  merge: { title: "Results merged", icon: CombineIcon },
  small_cell: { title: "Small-cell rule applied", icon: EyeOffIcon },
  spe_created: { title: "Secure processing environment created", icon: DatabaseZapIcon },
  download_attempt: { title: "Download attempt blocked", icon: LockIcon },
  decision: { title: "Decision", icon: GavelIcon },
};

const STATUS_STYLE: Record<LogStatus, { dot: string; chip: string; label: string }> = {
  ok: { dot: "bg-success text-success-foreground", chip: "bg-success/10 text-success", label: "OK" },
  info: { dot: "bg-info text-info-foreground", chip: "bg-info/10 text-info", label: "Info" },
  warning: { dot: "bg-warning text-warning-foreground", chip: "bg-warning/15 text-warning-foreground dark:text-warning", label: "Attention" },
  error: { dot: "bg-destructive text-white", chip: "bg-destructive/10 text-destructive", label: "Stopped" },
  blocked: { dot: "bg-destructive text-white", chip: "bg-destructive/10 text-destructive", label: "Blocked · 403" },
};

export function Timeline({ log }: { log: LogEvent[] }) {
  return (
    <ol className="relative grid">
      {log.map((event, i) => {
        const meta = STEP_META[event.step];
        const style = STATUS_STYLE[event.status];
        const Icon = meta.icon;
        return (
          <li key={event.id} className="relative grid grid-cols-[2.25rem_1fr] gap-4 pb-6 last:pb-0">
            {i < log.length - 1 && <span className="absolute top-9 bottom-0 left-[1.0625rem] w-px bg-border" />}
            <span className={cn("relative z-10 flex size-9 items-center justify-center rounded-full ring-4 ring-card", style.dot)}>
              <Icon className="size-4" />
            </span>
            <div className="grid min-w-0 gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{meta.title}</span>
                <span className={cn("rounded px-1.5 py-px text-[11px] font-medium", style.chip)}>{style.label}</span>
                <span className="ml-auto flex items-center gap-3 font-mono text-xs text-muted-foreground tabular-nums">
                  <span>{fmtTimePrecise(event.timestamp)}</span>
                  <span className="rounded bg-muted px-1.5 py-px">{formatDuration(event.duration_ms)}</span>
                </span>
              </div>
              <StepBody event={event} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function KV({ items }: { items: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid gap-x-4 gap-y-1.5 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-[10rem_1fr]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function StepBody({ event }: { event: LogEvent }) {
  switch (event.step) {
    case "received":
      return event.data.valid ? (
        <Muted>JSON parsed and all required fields present.</Muted>
      ) : (
        <ul className="list-disc pl-5 text-sm text-destructive">{event.data.schema_errors.map((e) => <li key={e}>{e}</li>)}</ul>
      );

    case "purpose_check":
      return (
        <KV
          items={[
            ["Result", event.data.allowed ? <span className="font-medium text-success">Permitted</span> : <span className="font-medium text-destructive">Prohibited</span>],
            ...(event.data.prohibited_category
              ? ([["Matched category", <span key="c" className="rounded bg-destructive/10 px-1.5 py-px font-medium text-destructive capitalize">{event.data.prohibited_category}</span>]] as Array<[string, React.ReactNode]>)
              : []),
            ...(event.data.article ? ([["Article", `Art. ${event.data.article}`]] as Array<[string, React.ReactNode]>) : []),
            ["Explanation", event.data.explanation],
          ]}
        />
      );

    case "classification": {
      const label = { statistics: "Statistics", access_with_justification: "Access with justification", other_access: "Other access" }[event.data.classified_as];
      return (
        <KV
          items={[
            ["Classified as", <span key="l" className="font-medium">{label}</span>],
            ["Justification given", event.data.justification_given ? "Yes" : "No"],
            ...(event.data.justification_sufficient !== null
              ? ([["Statistics insufficient?", event.data.justification_sufficient ? "Yes — justified" : "No — statistics are enough"]] as Array<[string, React.ReactNode]>)
              : []),
            ["Explanation", event.data.explanation],
          ]}
        />
      );
    }

    case "interpretation":
      return (
        <KV
          items={[
            ["Cohort", event.data.cohort],
            ["Groups", event.data.groups.length ? event.data.groups.join(", ") : "—"],
            ["Metrics", event.data.metrics.join(", ")],
          ]}
        />
      );

    case "terminology":
      return (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-3">Plain English</TableHead>
                <TableHead>System</TableHead>
                <TableHead className="pr-3">Codes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {event.data.mappings.map((m) => (
                <TableRow key={m.term} className={cn(!m.mapped && "bg-warning/10")}>
                  <TableCell className="pl-3 font-medium">{m.term}</TableCell>
                  <TableCell>{m.system ?? <span className="font-medium text-warning-foreground dark:text-warning">Unmapped</span>}</TableCell>
                  <TableCell className="pr-3 font-mono text-xs">{m.codes.length ? m.codes.join(", ") : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      );

    case "federated_execution":
      return (
        <div className="grid gap-2">
          {event.data.hospitals.map((h) => (
            <Collapsible key={h.name} className="rounded-lg border">
              <CollapsibleTrigger className="group flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm">
                <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-data-panel-open:rotate-90" />
                <ServerIcon className="size-4 text-muted-foreground" />
                <span className="font-medium">{h.name}</span>
                <span
                  className={cn(
                    "rounded px-1.5 py-px text-[11px] font-medium uppercase",
                    h.status === "ok" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
                  )}
                >
                  {h.status === "timeout" ? "timed out" : h.status}
                </span>
                <span className="ml-auto flex gap-4 text-xs text-muted-foreground tabular-nums">
                  <span>{formatDuration(h.query_ms)}</span>
                  <span>{h.opted_out_excluded} opted out excluded</span>
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="overflow-x-auto border-t bg-muted/40 p-3 font-mono text-xs leading-relaxed">{h.sql}</pre>
              </CollapsibleContent>
            </Collapsible>
          ))}
          <p className="text-xs text-muted-foreground">Partial counts per hospital are not shown, so small sub-results stay hidden.</p>
        </div>
      );

    case "merge":
      return <Muted>{event.data.hospitals_merged} hospital results combined. {event.data.strategy}.</Muted>;

    case "small_cell":
      return (
        <div className="grid gap-2">
          <Muted>{event.data.rule}</Muted>
          {event.data.cells.length === 0 ? (
            <Muted>No cells needed protection.</Muted>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="pl-3">Group</TableHead>
                    <TableHead>Metric</TableHead>
                    <TableHead>Shown as</TableHead>
                    <TableHead className="pr-3">Why</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {event.data.cells.map((c, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-3 font-medium">{c.group}</TableCell>
                      <TableCell>{c.metric}</TableCell>
                      <TableCell>
                        <span className={cn("rounded px-1.5 py-px font-mono text-xs font-semibold", c.outcome === "lt10" ? "bg-warning/15" : "bg-muted text-muted-foreground")}>
                          {c.outcome === "lt10" ? "<10" : "suppressed"}
                        </span>
                      </TableCell>
                      <TableCell className="pr-3 whitespace-normal text-muted-foreground">{c.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      );

    case "spe_created":
      return (
        <div className="grid gap-2">
          <KV
            items={[
              ["Schema", <code key="s" className="font-mono text-xs">{event.data.schema_name}</code>],
              ["Cohort size", <span key="c" className="font-semibold tabular-nums">{event.data.cohort_size.toLocaleString("en-US")}</span>],
              ["Record types", event.data.record_types.join(", ")],
            ]}
          />
          <div className="grid gap-2 sm:grid-cols-3">
            {event.data.per_hospital.map((h) => (
              <div key={h.name} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">{h.name}</p>
                <p className="text-muted-foreground tabular-nums">
                  {h.patients.toLocaleString("en-US")} patients · {h.records.toLocaleString("en-US")} records
                </p>
              </div>
            ))}
          </div>
        </div>
      );

    case "download_attempt":
      return (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <BanIcon className="size-4 shrink-0" />
          <span>
            <code className="font-mono text-xs">POST /spe/{event.data.spe_id}/download</code> → {event.data.http_status}. {event.data.message}
          </span>
        </div>
      );

    case "decision":
      return (
        <div className="flex flex-wrap items-center gap-2">
          <DecisionBadge decision={event.data.decision} />
          {event.data.articles.map((a) => (
            <span key={a} className="rounded bg-muted px-1.5 py-px font-mono text-xs">Art. {a}</span>
          ))}
        </div>
      );
  }
}
