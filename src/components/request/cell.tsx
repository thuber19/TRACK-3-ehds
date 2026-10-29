import type { CellValue, Metric } from "@/lib/types";
import { cn } from "@/lib/utils";

const nf0 = new Intl.NumberFormat("en-US");
const nf1 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function formatValue(value: number, metric: Metric) {
  if (metric.type === "count") return nf0.format(value);
  if (metric.type === "percent") return `${nf1.format(value)}%`;
  return nf1.format(value);
}

export function Cell({ cell, metric }: { cell: CellValue | undefined; metric: Metric }) {
  if (!cell || cell.kind === "suppressed") {
    return (
      <span className="inline-flex items-center rounded border border-dashed border-muted-foreground/40 bg-[repeating-linear-gradient(135deg,transparent,transparent_3px,var(--color-muted)_3px,var(--color-muted)_6px)] px-1.5 py-px text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        suppressed
      </span>
    );
  }
  if (cell.kind === "lt10") {
    return (
      <span className="inline-flex items-center rounded bg-warning/15 px-1.5 py-px font-mono text-xs font-semibold text-warning-foreground dark:text-warning">
        &lt;10
      </span>
    );
  }
  return <span className={cn("font-mono tabular-nums")}>{formatValue(cell.value, metric)}</span>;
}

export function CellLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6", className)}>
      <span className="flex items-center gap-2">
        <Cell cell={{ kind: "lt10" }} metric={{ key: "", label: "", type: "count" }} />
        Between 0 and 9 patients. The exact number is hidden to protect privacy.
      </span>
      <span className="flex items-center gap-2">
        <Cell cell={{ kind: "suppressed" }} metric={{ key: "", label: "", type: "count" }} />
        Based on fewer than 10 patients, so it could identify someone. Not shown.
      </span>
      <span>Percentages and means are rounded to one decimal.</span>
    </div>
  );
}
