"use client";

import { useEffect, useState } from "react";

import { api, type HealthStatus } from "@/lib/api";

const POLL_MS = 5000;

export function useHealth() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      api
        .health()
        .then((next) => {
          if (cancelled) return;
          setHealth(next);
          setUnreachable(false);
        })
        .catch(() => {
          if (!cancelled) setUnreachable(true);
        });
    };

    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return { health, unreachable };
}
