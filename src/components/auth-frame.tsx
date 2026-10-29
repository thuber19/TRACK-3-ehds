"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { SiteHeader } from "@/components/site-header";
import { api, type SessionUser } from "@/lib/api";

export function AuthFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);

  useEffect(() => {
    if (pathname === "/login") return;
    let cancelled = false;
    api
      .me()
      .then((next) => {
        if (!cancelled) setUser(next);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    if (pathname === "/login" || user === undefined) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    const home = user.role === "staff" ? "/staff" : "/applicant";
    if (pathname === "/" || (user.role === "applicant" && pathname.startsWith("/staff")) || (user.role === "staff" && pathname.startsWith("/applicant"))) {
      router.replace(home);
    }
  }, [pathname, router, user]);

  if (pathname === "/login") return children;
  if (!user) {
    return <p className="px-6 py-16 text-center text-sm text-muted-foreground">Opening the access body…</p>;
  }

  return (
    <>
      <SiteHeader user={user} />
      <main className="flex-1">{children}</main>
    </>
  );
}
