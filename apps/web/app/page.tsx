'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api, ApiError, type Job, date } from '../lib/client';
type Listing = { jobs: Job[]; total: number; pages: number };
type Metrics = { states: Record<string, number>; deadLetters: number; pendingDispatch: number; workers: number; dispatcher: boolean; averageDurationMs: number | null };
const examples: Record<string, object> = { echo: { message: 'Hello from the queue' }, sum: { numbers: [1, 2, 3] }, flaky: { failuresBeforeSuccess: 2, message: 'Eventually succeeds' }, sleep: { durationMs: 5000 } };
export default function Dashboard() {
  const [signedIn, setSignedIn] = useState(false), [checking, setChecking] = useState(true), [token, setToken] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [listing, setListing] = useState<Listing>({ jobs: [], total: 0, pages: 0 }), [metrics, setMetrics] = useState<Metrics | null>(null), [ready, setReady] = useState('Checking');
  const [page, setPage] = useState(1), [status, setStatus] = useState(''), [filterType, setFilterType] = useState(''), [deadLetter, setDeadLetter] = useState(false);
  const [type, setType] = useState('echo'), [payload, setPayload] = useState(JSON.stringify(examples.echo, null, 2)), [attempts, setAttempts] = useState(3), [backoff, setBackoff] = useState(1000), [runAt, setRunAt] = useState(''), [key, setKey] = useState('');
  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '10' });
      if (status) params.set('status', status); if (filterType) params.set('type', filterType); if (deadLetter) params.set('deadLetter', 'true');
      const [jobs, counts] = await Promise.all([api<Listing>(`jobs?${params}`), api<Metrics>('metrics')]);
      setListing(jobs); setMetrics(counts); setSignedIn(true); setError('');
      setReady(counts.workers && counts.dispatcher ? 'Ready' : 'Waiting for worker / dispatcher');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setSignedIn(false);
      else setError(e instanceof Error ? e.message : 'Could not load jobs');
    } finally { setChecking(false); }
  }, [page, status, filterType, deadLetter]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!signedIn) return; const timer = setInterval(() => { if (!document.hidden) void load(); }, 5000); return () => clearInterval(timer); }, [signedIn, load]);
  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('session', { method: 'POST', body: JSON.stringify({ token }) }); setToken(''); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Sign in failed'); } finally { setBusy(false); }
  }
  async function enqueue(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const body = { type, payload: JSON.parse(payload), maxAttempts: attempts, backoffMs: backoff, ...(runAt ? { runAt: new Date(runAt).toISOString() } : {}) };
      const response = await api<{ job: Job; replayed: boolean }>('jobs', { method: 'POST', headers: key ? { 'Idempotency-Key': key } : {}, body: JSON.stringify(body) });
      setNotice(`${response.replayed ? 'Existing job returned' : 'Job accepted'}: ${response.job.id}`); setPage(1); await load();
    } catch (e) { setError(e instanceof SyntaxError ? 'Payload must be valid JSON' : e instanceof Error ? e.message : 'Could not enqueue job'); } finally { setBusy(false); }
  }
  return <>
    <header><h1>Distributed Job Queue</h1>{signedIn && <button onClick={async () => { try { await api('session', { method: 'DELETE' }); setSignedIn(false); setNotice(''); } catch (e) { setError((e as Error).message); } }}>Sign out</button>}</header>
    <p className="muted">Demo handlers only. Jobs may execute again after a worker failure; use idempotent handlers for external effects.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {checking ? <p>Loading…</p> : !signedIn ? <form onSubmit={login}><h2>Demo sign in</h2><p>Enter DEMO_API_TOKEN from your local environment.</p><div className="fields"><label>Demo token<input type="password" value={token} onChange={e => setToken(e.target.value)} required autoComplete="current-password" /></label><button disabled={busy}>Sign in</button></div></form> : <>
      <h2>Metrics</h2>
      <p>Service: {ready}. Active workers: {metrics?.workers ?? 0}. Dispatcher: {metrics?.dispatcher ? 'online' : 'offline'}.</p>
      <div className="metrics">{Object.entries(metrics?.states ?? {}).map(([state, count]) => <span key={state}>{state}: <strong>{count}</strong></span>)}<span>dead letters: <strong>{metrics?.deadLetters ?? 0}</strong></span><span>pending dispatch: <strong>{metrics?.pendingDispatch ?? 0}</strong></span><span>mean execution: {metrics?.averageDurationMs == null ? '—' : `${Math.round(metrics.averageDurationMs)} ms`}</span></div>
      <h2>Enqueue job</h2>
      <form onSubmit={enqueue}>
        <div className="fields">
          <label>Handler<select value={type} onChange={e => { setType(e.target.value); setPayload(JSON.stringify(examples[e.target.value], null, 2)); }}>{Object.keys(examples).map(name => <option key={name}>{name}</option>)}</select></label>
          <label>Max attempts<input type="number" min="1" max="10" value={attempts} onChange={e => setAttempts(Number(e.target.value))} required /></label>
          <label>Backoff (ms)<input type="number" min="100" max="60000" value={backoff} onChange={e => setBackoff(Number(e.target.value))} required /></label>
          <label>Run at (local time)<input type="datetime-local" value={runAt} onChange={e => setRunAt(e.target.value)} /></label>
          <label>Idempotency key (optional)<input maxLength={128} pattern="[a-zA-Z0-9._\-]+" value={key} onChange={e => setKey(e.target.value)} /></label>
        </div>
        <label className="payload">Payload (JSON)<textarea value={payload} onChange={e => setPayload(e.target.value)} required spellCheck={false} /></label>
        <div className="actions"><button disabled={busy}>Enqueue job</button><span className="muted">Retries use exponential backoff. Empty run time starts immediately.</span></div>
      </form>
      {notice && <p role="status" className="notice">{notice}</p>}
      <h2>Jobs</h2>
      <div className="filters">
        <label>Status<select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">All states</option>{['queued', 'running', 'succeeded', 'failed', 'cancelled'].map(s => <option key={s}>{s}</option>)}</select></label>
        <label>Job type<select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(1); }}><option value="">All handlers</option>{Object.keys(examples).map(s => <option key={s}>{s}</option>)}</select></label>
        <label>Dead-letter queue<select value={String(deadLetter)} onChange={e => { setDeadLetter(e.target.value === 'true'); setPage(1); }}><option value="false">All jobs</option><option value="true">Dead letters only</option></select></label>
        <button onClick={() => void load()}>Refresh</button>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Job ID</th><th>Handler</th><th>State</th><th>Attempts</th><th>Scheduled</th><th>Created</th></tr></thead><tbody>{listing.jobs.length ? listing.jobs.map(job => <tr key={job.id}><td><Link href={`/jobs/${job.id}`}>{job.id.slice(0, 8)}</Link>{job.deadLetter && ' (DLQ)'}</td><td>{job.type}</td><td>{job.status}</td><td>{job.attempts}/{job.maxAttempts}</td><td>{date(job.scheduledAt)}</td><td>{date(job.createdAt)}</td></tr>) : <tr><td colSpan={6}>No jobs match these filters.</td></tr>}</tbody></table></div>
      <div className="actions"><button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page} of {Math.max(1, listing.pages)} · {listing.total} jobs</span><button disabled={page >= listing.pages} onClick={() => setPage(p => p + 1)}>Next</button></div>
      <p className="muted">Refreshes every 5 seconds while this tab is visible.</p>
    </>}
  </>;
}
