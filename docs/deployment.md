# Free portfolio deployment

Live dashboard: https://distributed-job-queue-alpha.vercel.app

The web dashboard runs on Vercel Hobby. A Render Free Docker web service runs
four separate processes: Express API, dispatcher, BullMQ worker, and Redis.
PostgreSQL on Neon Free holds durable jobs, history, outbox, and dead letters.

This is a shared public portfolio demo. Visitors can view and cancel sample jobs.
Do not submit personal information. Production identity management and tenant
isolation are outside this demo's scope.

## Backend

`Dockerfile.render` builds only the API and starts `scripts/render-stack.mjs`.
The supervisor starts Redis, applies migrations using the direct database URL,
then starts the API, dispatcher, and worker as separate Node processes.
An unexpected child exit stops the stack so Render can restart it. SIGTERM drains
children with a global 25-second deadline and stops Redis last.

Redis binds only to `127.0.0.1:6379`, has a 64 MB limit and `noeviction`, and has
no disk persistence. Restarts lose Redis state. The dispatcher replays outstanding
jobs from PostgreSQL; workers retain the existing at-least-once delivery and
execution-budget semantics. The API requires a gateway secret as well as the
backend token. Rate limiting uses the client IP authenticated by the web gateway.

Render service: free Docker, Frankfurt, repository root, `Dockerfile.render`.
`render.yaml` describes the same setup for future Blueprint deployments. Do not
apply it to create a duplicate of the already provisioned service.

Required backend environment variables:

- `DATABASE_URL`: pooled Neon connection, shared by runtime processes.
- `DATABASE_URL_UNPOOLED`: direct connection for migrations.
- `DEMO_API_TOKEN`: random API credential, never published to the browser.
- `API_GATEWAY_SECRET`: same random server-side secret on both hosts.
- `WORKER_CONCURRENCY=2`, `QUEUE_PREFIX=djqp-live`.
- `DEMO_MAX_JOBS=1000`, `DEMO_RETENTION_HOURS=24`.

The live demo caps stored jobs at 1,000. Completed, failed, and cancelled jobs
older than 24 hours are cleaned from Redis and PostgreSQL in bounded batches.
Queued/running jobs are preserved. Idempotency keys remain valid for the retained
record's lifetime. Local deployments retain the original unbounded defaults.

## Frontend

Vercel project root: `apps/web`, Next.js, using `apps/web/vercel.json`.
Production access must be public. Required web environment variables:

- `API_URL`: Render API HTTPS origin.
- `WEB_ORIGIN`: exact public web origin, with no trailing slash.
- `COOKIE_SECURE=true`.
- `DEMO_API_TOKEN` and `API_GATEWAY_SECRET`: same credentials as backend.
- `DEMO_SESSION_SECRET`: separate random signing key of at least 32 characters.
- `PUBLIC_DEMO_ENABLED=true`, `NEXT_PUBLIC_DEMO_ENABLED=true`.

The “Try live demo” button creates a one-hour signed, opaque HttpOnly session.
The gateway resolves it to the backend credential on the server. The credential
never appears in the public session cookie or a client-side environment variable.

## Free-plan behavior

Render sleeps after 15 minutes without incoming traffic; wake-up can take about
a minute. All local workers and Redis pause or restart with that service. Jobs
scheduled while the service sleeps execute when it wakes, rather than exactly at
the scheduled time. Vercel session requests allow time for that wake-up. A visible,
signed-in dashboard polls and keeps the backend active. Render's monthly free
hours are shared with the account's other services; Neon and Vercel quotas also apply.
No artificial keep-alive or paid services are configured.

## Validation

```powershell
npm run typecheck
npm test
npm run build
$env:PLAYWRIGHT_BASE_URL = 'https://your-web.vercel.app'
npx playwright test --timeout 120000
```

Check the backend `/health` and `/ready`, then exercise `echo`, `sum`, retries,
dead letters, delayed execution, cancellation, and idempotency through the web
gateway. Do not run database-resetting integration tests against production.
