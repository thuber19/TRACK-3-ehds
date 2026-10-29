import { toDetail, toListItem, toOutcome } from "./adapt";
import type { RequestDetail, RequestListItem, RequestOutcome } from "./types";

/**
 * Same-origin `/api` is proxied to the FastAPI app (see next.config.ts).
 * Set NEXT_PUBLIC_API_URL only when the browser should call the API host directly.
 */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "/api";

export interface SessionUser {
  id: number;
  username: string;
  role: "applicant" | "staff";
  display_name: string;
}

export interface HospitalNodeStatus {
  name: string;
  ok: boolean;
  patients: number | null;
  endpoint: string;
}

export interface HealthStatus {
  status: "ok" | "degraded";
  data_mode: string;
  nodes: HospitalNodeStatus[];
  warnings: string[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    credentials: "include",
    cache: "no-store",
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (body as { detail?: string; message?: string } | null)?.detail ||
      (body as { message?: string } | null)?.message ||
      res.statusText;
    throw new ApiError(res.status, typeof message === "string" ? message : res.statusText, body);
  }
  return body as T;
}

export const api = {
  login: (username: string, password: string) =>
    call<SessionUser>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => call<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  me: () => call<SessionUser>("/auth/me"),
  health: () => call<HealthStatus>("/health"),
  examples: () => call<Record<string, unknown>[]>("/examples"),
  submitRequest: async (request: unknown, signal?: AbortSignal) => {
    const row = await call<Record<string, unknown>>("/requests", {
      method: "POST",
      body: JSON.stringify(request),
      signal,
    });
    return toOutcome(row);
  },
  listRequests: async (): Promise<RequestListItem[]> => {
    const rows = await call<Record<string, unknown>[]>("/requests");
    return rows.map(toListItem);
  },
  getRequest: async (id: string): Promise<RequestDetail> => {
    const row = await call<Record<string, unknown>>(`/requests/${encodeURIComponent(id)}`);
    return toDetail(row);
  },
  attemptSpeDownload: (speId: string) =>
    call<never>(`/spe/${encodeURIComponent(speId)}/download`, { method: "POST" }),
};

export type { RequestDetail, RequestListItem, RequestOutcome };
