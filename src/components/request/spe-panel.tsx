"use client";

import { useState } from "react";
import { DatabaseIcon, DownloadIcon, FingerprintIcon, LockIcon, ShieldAlertIcon, UsersIcon } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import type { SpeResult } from "@/lib/types";

const BLOCKED_MESSAGE = "Data cannot leave the secure processing environment (Art. 73).";

export function SpePanel({ spe, interactive = true }: { spe: SpeResult; interactive?: boolean }) {
  const [blocked, setBlocked] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function attempt() {
    setPending(true);
    try {
      await api.attemptSpeDownload(spe.spe_id);
      setBlocked(BLOCKED_MESSAGE);
    } catch (error) {
      const message = error instanceof ApiError && error.status === 403 ? error.message || BLOCKED_MESSAGE : BLOCKED_MESSAGE;
      setBlocked(message);
      toast.error("Download blocked", { description: "This attempt was logged." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={UsersIcon} label="Cohort size" value={new Intl.NumberFormat("en-US").format(spe.cohort_size)} hint="patients, exact" />
        <Stat icon={FingerprintIcon} label="SPE identifier" value={spe.spe_id} mono />
        <Stat icon={DatabaseIcon} label="Schema" value={spe.schema_name} mono />
      </div>

      <div className="rounded-lg border p-4">
        <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Record types copied</p>
        <div className="flex flex-wrap gap-2">
          {spe.record_types.map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5 rounded-md bg-info/10 px-2.5 py-1 text-sm font-medium text-info">
              <DatabaseIcon className="size-3.5" />
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-dashed bg-muted/40 p-4 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
            <LockIcon className="size-4 text-muted-foreground" />
          </span>
          <div className="text-sm">
            <p className="font-medium">Download is not available</p>
            <p className="text-muted-foreground">Work with the data inside the secure environment. Exports are blocked and every attempt is logged.</p>
          </div>
        </div>
        <Button
          variant="outline"
          className="cursor-not-allowed text-muted-foreground line-through decoration-muted-foreground/60"
          onClick={interactive ? attempt : undefined}
          disabled={!interactive || pending}
          aria-describedby="spe-blocked"
        >
          <DownloadIcon />
          Download data
        </Button>
      </div>

      {blocked && (
        <Alert variant="destructive" id="spe-blocked">
          <ShieldAlertIcon />
          <AlertTitle>Download blocked</AlertTitle>
          <AlertDescription>{blocked} This attempt has been recorded in the audit log.</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  mono,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </p>
      <p className={mono ? "mt-1.5 truncate font-mono text-sm font-semibold" : "mt-1 text-2xl font-semibold tabular-nums"}>{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
