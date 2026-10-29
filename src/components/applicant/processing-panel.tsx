"use client";

import { useEffect, useState } from "react";
import { CheckIcon, Loader2Icon } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TARGET_SECONDS } from "@/lib/constants";
import { cn } from "@/lib/utils";

const STAGES = [
  "Validating request",
  "Checking the purpose",
  "Classifying the request type",
  "Interpreting definitions",
  "Mapping terms to medical codes",
  "Querying Klinikum Nord, Süd and West",
  "Merging and protecting small groups",
];

export function ProcessingPanel({ startedAt, requestId }: { startedAt: number; requestId: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  const elapsed = (now - startedAt) / 1000;
  const pct = Math.min(100, (elapsed / TARGET_SECONDS) * 100);
  const stage = Math.min(STAGES.length - 1, Math.floor(elapsed / 0.9));

  return (
    <Card className="mx-auto w-full max-w-xl">
      <CardHeader className="text-center">
        <CardDescription className="font-mono">{requestId}</CardDescription>
        <CardTitle className="text-lg">Assessing your request</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid justify-items-center gap-1">
          <span className="font-mono text-5xl font-semibold tracking-tight tabular-nums">{elapsed.toFixed(1)}<span className="text-2xl text-muted-foreground">s</span></span>
          <span className="text-xs text-muted-foreground">Target: under {TARGET_SECONDS} s</span>
        </div>
        <div className="grid gap-1.5">
          <div className="relative h-2 overflow-hidden rounded-full bg-muted">
            <div className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-100" style={{ width: `${pct}%` }} />
            <div className="absolute inset-0 animate-pulse bg-linear-to-r from-transparent via-primary/20 to-transparent" />
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>0 s</span>
            <span>{TARGET_SECONDS} s</span>
          </div>
        </div>
        <ol className="grid gap-2">
          {STAGES.map((label, i) => (
            <li key={label} className={cn("flex items-center gap-3 text-sm transition-opacity", i > stage && "opacity-40")}>
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-full border",
                  i < stage && "border-primary bg-primary text-primary-foreground",
                  i === stage && "border-primary text-primary",
                )}
              >
                {i < stage ? <CheckIcon className="size-3" /> : i === stage ? <Loader2Icon className="size-3 animate-spin" /> : null}
              </span>
              {label}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
