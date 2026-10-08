export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, { ...init, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await response.json();
  if (!response.ok) throw new ApiError(body.error ?? 'Request failed', response.status);
  return body as T;
}
export type Job = {
  id: string; type: string; status: string; attempts: number; maxAttempts: number;
  backoffMs: number; payload: unknown; result: unknown; error: string | null;
  idempotencyKey: string | null; scheduledAt: string; createdAt: string; startedAt: string | null; finishedAt: string | null;
  history: { id: number; kind: string; attempt: number; message: string | null; createdAt: string }[];
  deadLetter: { reason: string; createdAt: string; deliveredAt: string | null } | null;
  outbox: { publishedAt: string | null } | null;
};
export const date = (value: string | null) => value ? new Date(value).toLocaleString() : '—';
