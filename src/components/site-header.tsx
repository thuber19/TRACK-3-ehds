"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoonIcon, ShieldCheckIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { api, type SessionUser } from "@/lib/api";
import { useHealth } from "@/lib/use-health";
import { cn } from "@/lib/utils";

export function SiteHeader({ user }: { user: SessionUser }) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { health, unreachable } = useHealth();
  const home = user.role === "staff" ? "/staff" : "/applicant";

  const connected = health?.nodes.filter((node) => node.ok).length ?? 0;
  const total = health?.nodes.length ?? 0;
  const healthLabel = unreachable
    ? "Hospital databases unreachable"
    : health
      ? `${connected} of ${total} hospital databases connected`
      : "Checking hospital databases";

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link href={home} className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheckIcon className="size-4" />
          </span>
          <span className="hidden sm:inline">Health Data Access Body</span>
        </Link>
        <span className="text-sm text-muted-foreground">{user.display_name}</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
            <span
              className={cn(
                "size-1.5 rounded-full",
                health?.status === "ok" && !unreachable ? "bg-success" : "bg-warning",
              )}
            />
            {healthLabel}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await api.logout();
              router.replace("/login");
              router.refresh();
            }}
          >
            Log out
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle theme"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          >
            <SunIcon className="dark:hidden" />
            <MoonIcon className="hidden dark:block" />
          </Button>
        </div>
      </div>
    </header>
  );
}
