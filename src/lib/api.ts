import type { DataRequest, RequestDetail, RequestListItem, RequestOutcome } from "./types";

/**
 * Base URL of the backend. Leave NEXT_PUBLIC_API_URL unset to use the
 * built-in mock under /api; set it (e.g. http://localhost:8000) for the real one.
 */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "/api";

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
    cache: "no-store",
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, (body as { message?: string })?.message ?? res.statusText, body);
  }
  return body as T;
}

export const api = {
  submitRequest: (request: DataRequest, signal?: AbortSignal) =>
    call<RequestOutcome>("/requests", { method: "POST", body: JSON.stringify(request), signal }),
  listRequests: () => call<RequestListItem[]>("/requests"),
  getRequest: (id: string) => call<RequestDetail>(`/requests/${encodeURIComponent(id)}`),
  attemptSpeDownload: (speId: string) =>
    call<never>(`/spe/${encodeURIComponent(speId)}/download`, { method: "POST" }),
};
