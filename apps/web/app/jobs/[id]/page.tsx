'use client';
import { useCallback, useEffect, useState, use } from 'react';
import Link from 'next/link';
import { api, type Job, date } from '../../../lib/client';
export default function JobDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [job, setJob] = useState<Job | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const result = await api<{ job: Job }>(`jobs/${id}`); setJob(result.job); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load job'); }
  }, [id]);
  useEffect(() => { void load(); const timer = setInterval(() => { if (!document.hidden) void load(); }, 5000); return () => clearInterval(timer); }, [load]);
  async function cancel() {
    setBusy(true);
    try { await api(`jobs/${id}/cancel`, { method: 'POST' }); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <>
    <header><h1>Job detail</h1><Link href="/">Back to jobs</Link></header>
    {error && <p role="alert" className="error">{error}</p>}
    {!job ? <p>{error ? 'Job unavailable. Sign in from the dashboard if needed.' : 'Loading…'}</p> : <>
      <dl><dt>ID</dt><dd>{job.id}</dd><dt>Handler / state</dt><dd>{job.type} / <strong data-testid="job-state">{job.status}</strong></dd><dt>Attempts</dt><dd>{job.attempts} / {job.maxAttempts}; exponential backoff from {job.backoffMs} ms</dd><dt>Idempotency key</dt><dd>{job.idempotencyKey ?? '—'}</dd><dt>Created / scheduled</dt><dd>{date(job.createdAt)} / {date(job.scheduledAt)}</dd><dt>Started / finished</dt><dd>{date(job.startedAt)} / {date(job.finishedAt)}</dd><dt>Dispatch</dt><dd>{job.outbox?.publishedAt ? `Published ${date(job.outbox.publishedAt)}` : 'Pending'}</dd></dl>
      <div className="actions"><button onClick={() => void load()}>Refresh</button>{['queued', 'running'].includes(job.status) && <button disabled={busy} onClick={() => void cancel()}>Cancel job</button>}</div>
      <h2>Payload</h2><pre>{JSON.stringify(job.payload, null, 2)}</pre>
      <h2>Result</h2><pre>{job.result === null ? 'No result' : JSON.stringify(job.result, null, 2)}</pre>
      {job.error && <p className="error">Last error: {job.error}</p>}
      {job.deadLetter && <p className="notice">Dead-letter queue: {job.deadLetter.reason}. Redis delivery: {job.deadLetter.deliveredAt ? date(job.deadLetter.deliveredAt) : 'pending'}.</p>}
      <h2>History</h2><div className="table-wrap"><table><thead><tr><th>Time</th><th>Event</th><th>Attempt</th><th>Details</th></tr></thead><tbody>{job.history.map(event => <tr key={event.id}><td>{date(event.createdAt)}</td><td>{event.kind}</td><td>{event.attempt}</td><td>{event.message ?? '—'}</td></tr>)}</tbody></table></div>
    </>}
  </>;
}
