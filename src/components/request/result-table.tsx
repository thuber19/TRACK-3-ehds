"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { Metric, ResultRow, StatisticalResult } from "@/lib/types";

import { Cell } from "./cell";

function metricHeader(m: Metric) {
  return (
    <span className="flex flex-col items-end leading-tight">
      <span>{m.label}</span>
      <span className="text-[11px] font-normal text-muted-foreground">
        {m.type === "count" ? "count" : m.type === "percent" ? "%" : `mean${m.unit ? `, ${m.unit}` : ""}`}
      </span>
    </span>
  );
}

function GroupedTable({ result }: { result: StatisticalResult }) {
  const dim = result.dimensions[0];
  const byGroup = new Map(result.rows.map((r) => [r.group[0], r]));
  const groups = dim ? dim.groups : [""];
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-[40%]">{dim?.label ?? "Group"}</TableHead>
          {result.metrics.map((m) => (
            <TableHead key={m.key} className="text-right">
              {metricHeader(m)}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((g) => {
          const row = dim ? byGroup.get(g) : result.rows[0];
          return (
            <TableRow key={g}>
              <TableCell className="font-medium">{g || "All patients"}</TableCell>
              {result.metrics.map((m) => (
                <TableCell key={m.key} className="text-right">
                  <Cell cell={row?.values[m.key] ?? { kind: "lt10" }} metric={m} />
                </TableCell>
              ))}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function CrossTable({ result, metric }: { result: StatisticalResult; metric: Metric }) {
  const [rowDim, colDim] = result.dimensions;
  const lookup = new Map<string, ResultRow>(result.rows.map((r) => [r.group.join("\u0000"), r]));
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>
            {rowDim.label} <span className="text-muted-foreground">×</span> {colDim.label}
          </TableHead>
          {colDim.groups.map((c) => (
            <TableHead key={c} className="text-right">
              {c}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rowDim.groups.map((r) => (
          <TableRow key={r}>
            <TableCell className="font-medium">{r}</TableCell>
            {colDim.groups.map((c) => (
              <TableCell key={c} className="text-right">
                <Cell cell={lookup.get(`${r}\u0000${c}`)?.values[metric.key] ?? { kind: "lt10" }} metric={metric} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ResultTable({ result }: { result: StatisticalResult }) {
  if (result.dimensions.length < 2) return <GroupedTable result={result} />;

  if (result.metrics.length === 1) return <CrossTable result={result} metric={result.metrics[0]} />;

  return (
    <Tabs defaultValue={result.metrics[0].key} className="gap-3">
      <TabsList>
        {result.metrics.map((m) => (
          <TabsTrigger key={m.key} value={m.key}>
            {m.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {result.metrics.map((m) => (
        <TabsContent key={m.key} value={m.key}>
          <CrossTable result={result} metric={m} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
