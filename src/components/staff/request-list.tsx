"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { InboxIcon, RefreshCwIcon, SearchIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArticleChipsInline } from "@/components/request/article-chips";
import { DecisionBadge } from "@/components/request/decision-badge";
import { formatDuration } from "@/components/request/outcome-view";
import { api } from "@/lib/api";
import { useHealth } from "@/lib/use-health";
import { REQUESTED_AS_LABEL } from "@/lib/constants";
import type { Decision, RequestListItem, RequestStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

import { fmtDateTime } from "./format";

type Filter = "ALL" | Decision;

const FILTERS: Array<{ key: Filter; label: string; dot: string }> = [
  { key: "ALL", label: "All requests", dot: "bg-foreground/60" },
  { key: "APPROVE_STATISTICAL", label: "Approved (statistics)", dot: "bg-success" },
  { key: "APPROVE_SPE", label: "Approved (secure env.)", dot: "bg-info" },
  { key: "REJECT", label: "Rejected", dot: "bg-destructive" },
];

export function RequestList() {
  const router = useRouter();
  const [items, setItems] = useState<RequestListItem[] | null>(null);
  const { health } = useHealth();
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");

  const load = useCallback(() => {
    api
      .listRequests()
      .then((data) => {
        setItems(data);
        setError(null);
      })
      .catch(() => setError("Could not load requests from the backend."));
  }, []);

  useEffect(load, [load]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { ALL: 0, APPROVE_STATISTICAL: 0, APPROVE_SPE: 0, REJECT: 0 };
    items?.forEach((i) => {
      c.ALL++;
      if (i.decision) c[i.decision]++;
    });
    return c;
  }, [items]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter(
      (i) =>
        (filter === "ALL" || i.decision === filter) &&
        (!q || [i.id, i.applicant_name, i.organisation, i.purpose].some((v) => v.toLowerCase().includes(q))),
    );
  }, [items, filter, query]);

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Requests</h1>
          <p className="text-muted-foreground">Every request, its decision and how long it took. Click a row to see the full log.</p>
        </div>
        <Button variant="outline" onClick={load}>
          <RefreshCwIcon />
          Refresh
        </Button>
      </div>

      {health && (
        <Card className="gap-0 py-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <div>
              <p className="text-sm font-medium">Federated hospital databases</p>
              <p className="text-xs text-muted-foreground">
                Queries run on these nodes in parallel. Mode: {health.data_mode}.
              </p>
            </div>
            <Badge variant={health.status === "ok" ? "secondary" : "destructive"}>{health.status}</Badge>
          </div>
          {health.warnings.length > 0 && (
            <p className="border-b bg-warning/10 px-4 py-2 text-sm text-warning-foreground">{health.warnings.join(" ")}</p>
          )}
          <div className="grid gap-3 p-4 sm:grid-cols-3">
            {health.nodes.map((node) => (
              <div key={node.name} className="rounded-lg border p-3">
                <p className="flex items-center gap-2 font-medium">
                  <span className={cn("size-2 rounded-full", node.ok ? "bg-success" : "bg-destructive")} />
                  {node.name}
                </p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{node.endpoint}</p>
                <p className="mt-2 text-sm tabular-nums text-muted-foreground">
                  {node.ok ? `${node.patients?.toLocaleString("en-US")} patients` : "Not reachable"}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              "grid gap-1 rounded-xl border bg-card p-4 text-left transition-all hover:border-primary/40",
              filter === f.key && "border-primary ring-2 ring-primary/15",
            )}
          >
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className={cn("size-2 rounded-full", f.dot)} />
              {f.label}
            </span>
            <span className="text-3xl font-semibold tabular-nums">{items ? counts[f.key] : "–"}</span>
          </button>
        ))}
      </div>

      <Card className="gap-0 py-0">
        <div className="flex items-center gap-3 border-b p-3">
          <div className="relative w-full max-w-sm">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search ID, applicant, purpose…" className="pl-8" />
          </div>
          <span className="ml-auto text-sm text-muted-foreground">
            {visible.length} of {items?.length ?? 0}
          </span>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="pl-4">ID</TableHead>
              <TableHead>Applicant</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="w-[22%]">Purpose</TableHead>
              <TableHead>Decision</TableHead>
              <TableHead>Articles</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead className="text-right">Time</TableHead>
              <TableHead className="pr-4">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!items &&
              !error &&
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 9 }).map((__, j) => (
                    <TableCell key={j} className="first:pl-4">
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            {visible.map((i) => (
              <TableRow
                key={i.id}
                className="cursor-pointer"
                tabIndex={0}
                onClick={() => router.push(`/staff/${encodeURIComponent(i.id)}`)}
                onKeyDown={(e) => e.key === "Enter" && router.push(`/staff/${encodeURIComponent(i.id)}`)}
              >
                <TableCell className="pl-4 font-mono text-xs font-semibold text-primary">{i.id}</TableCell>
                <TableCell>
                  <div className="grid leading-tight">
                    <span className="font-medium">{i.applicant_name}</span>
                    <span className="max-w-48 truncate text-xs text-muted-foreground">{i.organisation}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-normal">
                    {REQUESTED_AS_LABEL[i.requested_as]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className="line-clamp-1 max-w-64 whitespace-normal text-muted-foreground" title={i.purpose}>
                    {i.purpose}
                  </span>
                </TableCell>
                <TableCell>{i.decision ? <DecisionBadge decision={i.decision} short /> : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>
                  <ArticleChipsInline articles={i.articles} />
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">{fmtDateTime(i.submitted_at)}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">
                  {i.processing_ms != null ? formatDuration(i.processing_ms) : "—"}
                </TableCell>
                <TableCell className="pr-4">
                  <StatusPill status={i.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {(error || (items && visible.length === 0)) && (
          <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
            <InboxIcon className="size-6" />
            {error ?? "No requests match this filter."}
          </div>
        )}
      </Card>
    </div>
  );
}

export function StatusPill({ status }: { status: RequestStatus }) {
  const styles = {
    completed: "text-success",
    processing: "text-info",
    failed: "text-destructive",
  } as const;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium capitalize", styles[status])}>
      <span className={cn("size-1.5 rounded-full bg-current", status === "processing" && "animate-pulse")} />
      {status}
    </span>
  );
}
