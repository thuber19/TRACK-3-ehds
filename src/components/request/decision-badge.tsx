import { CheckCircle2Icon, LockIcon, XCircleIcon } from "lucide-react";

import { DECISION_META } from "@/lib/constants";
import type { Decision } from "@/lib/types";
import { cn } from "@/lib/utils";

const TONE = {
  destructive: "bg-destructive/10 text-destructive ring-destructive/20",
  success: "bg-success/12 text-success ring-success/25",
  info: "bg-info/12 text-info ring-info/25",
} as const;

const ICON = {
  REJECT: XCircleIcon,
  APPROVE_STATISTICAL: CheckCircle2Icon,
  APPROVE_SPE: LockIcon,
} as const;

export function DecisionBadge({
  decision,
  size = "default",
  short = false,
  className,
}: {
  decision: Decision;
  size?: "default" | "lg";
  short?: boolean;
  className?: string;
}) {
  const meta = DECISION_META[decision];
  const Icon = ICON[decision];
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full font-medium whitespace-nowrap ring-1 ring-inset",
        size === "lg" ? "px-3.5 py-1.5 text-base [&>svg]:size-5" : "px-2 py-0.5 text-xs [&>svg]:size-3.5",
        TONE[meta.tone],
        className,
      )}
    >
      <Icon />
      {short ? meta.short : meta.label}
    </span>
  );
}
