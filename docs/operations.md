# Local operation and API contract

This is a local demonstration. Handlers have no network side effects and require no production credentials. The dashboard is deliberately a plain table and form interface. README.md is intentionally absent.

## Docker Compose

Copy `.env.example` to `.env`, choose a demo token (16–256 characters), then run:

```sh
docker compose up --build -d
docker compose ps
```

Open http://localhost:3000 and enter the configured DEMO_API_TOKEN. API health and readiness are at http://localhost:4000/health and /ready. Host ports can be changed with POSTGRES_PORT, REDIS_PORT, API_PORT and WEB_PORT. When changing API_PORT for native development, also change PORT and API_URL. Containers use their internal service ports independently of host ports.

Compose starts PostgreSQL, persistent Redis (AOF, no eviction), migrations, API, dispatcher, worker and dashboard. Migration completion gates the application processes. SIGTERM drains active work for up to 30 seconds; Compose allows 35 seconds before forcibly stopping a process. Scale workers with `docker compose up -d --scale worker=3`. API readiness requires database and Redis connectivity plus recent dispatcher and worker heartbeats. Worker heartbeats include a database check and expire after 15 seconds.

```sh
docker compose logs -f api dispatcher worker
docker compose down
```

`down` retains database and queue volumes. Do not delete volumes if you want to keep demo jobs.

## Native development

Node.js 22.12+ is required. PostgreSQL and Redis must be running. Set DATABASE_URL, REDIS_URL and DEMO_API_TOKEN in root `.env`.

```sh
npm ci
npm run db:generate
npm run db:migrate
npm run dev:api
# In separate terminals:
npm run dev:worker
npm run dispatcher -w @queue/api
npm run dev:web
```

The API and worker load root `.env`; the web launcher uses WEB_PORT and API_URL. No CORS configuration is necessary: browser requests use the dashboard's same-origin server proxy. Demo sign-in stores the token in a one-hour HttpOnly, SameSite=Strict cookie. Mutations require an Origin matching the public Host and protocol (including a published container port); set WEB_ORIGIN to the exact public origin when using an HTTPS reverse proxy. COOKIE_SECURE=false supports local HTTP; set it to true when using HTTPS. This demo uses one shared authorization scope; it has no production user accounts or tenant isolation. Compose binds exposed services to loopback.

## API

All `/api/*` requests require `Authorization: Bearer <DEMO_API_TOKEN>`. Every API replica shares a Redis rate limit of 120 requests/minute per direct client IP (including unauthorized requests). The web proxy shares one upstream IP. The API ignores forwarded IP headers; configure an explicit trusted proxy policy before exposing it behind a reverse proxy.

- `POST /api/jobs`: `{ "type": "echo", "payload": { "message": "hello" }, "maxAttempts": 3, "backoffMs": 1000, "runAt": "2026-10-09T12:00:00Z" }`. `runAt` is optional, supports offsets, and cannot be more than 30 days ahead. Attempts include the initial execution (1–10); retry delay doubles from backoffMs (100–60000). Body limit: 32 KiB. Returns 201 for creation.
- Optional `Idempotency-Key` (1–128 letters, digits, `.`, `_`, `-`): matching normalized requests return the existing job with 200; different requests under the same key return 409. Keys remain reserved for the lifetime of the job. Acceptance atomically writes job, history and outbox in PostgreSQL; dispatch continues after Redis recovery.
- `GET /api/jobs?page=1&pageSize=20&status=queued&type=echo&deadLetter=true`: pageSize up to 100, optional filters, newest first, with total/pages. Count and rows share a repeatable-read snapshot; separate page requests can shift when new jobs arrive.
- `GET /api/jobs/:id`: payload, result, timestamps, dispatch status, dead-letter metadata and chronological history.
- `POST /api/jobs/:id/cancel`: queued/running jobs become cancelled. Repeating cancellation returns 200; other terminal states return 409. Running demo handlers stop cooperatively and fenced database writes cannot replace cancellation with success. Already-published delayed Redis entries can remain until their scheduled time; the worker skips cancelled jobs.
- `GET /api/metrics`: PostgreSQL state counts, dead letters, pending dispatch, recent live workers, dispatcher presence and mean successful execution duration.
- `GET /health`: process liveness. `GET /ready`: 200 only when database, Redis, dispatcher and a worker are available; otherwise 503. These probes require no authorization.

Handlers:

| Type | Payload | Behavior |
| --- | --- | --- |
| echo | `{ "message": "hello" }` | Returns the message, up to 2000 characters |
| sum | `{ "numbers": [1, 2, 3] }` | Sums 1–100 finite numbers, each within ±1e12 |
| flaky | `{ "failuresBeforeSuccess": 2, "message": "ok" }` | Fails the first 0–9 executions, then returns the message |
| sleep | `{ "durationMs": 5000 }` | Waits 10–30000ms, checking cancellation every 100ms |

Unknown fields/handlers are rejected. Job payloads and results are visible to authorized demo users, but never logged. Operational logs are JSON with request/job IDs and fixed error codes; credentials, bodies, payloads and raw errors are redacted.

## Delivery and recovery

BullMQ owns atomic Redis claims and renewable leases. On worker loss another worker detects expired leases and retries the job (at most two stalled recoveries). PostgreSQL claim tokens fence writes from replaced executions. The execution budget also applies to crash recovery. Terminal database state is checked before each handler invocation, covering crashes after database completion but before Redis acknowledgement. The dispatcher reconciles terminal queue failures into database history and a durable dead-letter outbox, then publishes the Redis `dead-letter` queue. Cancellation never creates a dead letter.

Delivery is at least once. Idempotency keys prevent duplicate acceptance; they do not guarantee exactly-once external side effects. Any future handler with external effects must implement its own idempotency using job IDs. The dispatcher replays missing Redis entries for nonterminal database jobs. Redis IDs, database jobs/history and dead letters are retained indefinitely for this MVP; a bounded retention/archive policy and dead-letter redrive are future work.

## Checks

```sh
npm run typecheck
npm test
npm run test:integration
npx playwright install chromium
npm run test:smoke
npm audit
```

Integration checks create a disposable PostgreSQL database, apply actual migrations, exercise real Redis claims/retries and kill worker subprocesses to verify recovery; the configured PostgreSQL account needs permission to create/drop databases. Tests remove the disposable database and their Redis queues. They never mutate the configured application database. The browser smoke builds both applications and starts an API, dispatcher, worker and production Next server; it requires migrated local PostgreSQL/Redis and free PORT/WEB_PORT values, and leaves one completed demo job. To smoke-test an already-running Compose stack, run `SMOKE_EXTERNAL=true npm run test:smoke` with matching `.env` host URLs/ports.

No remote repository or push is configured by this implementation. Feature commits remain separate for review.

## Workspace verification caveat

During implementation this host's filesystem had no space available to non-root processes, and normal PostgreSQL volume initialization failed with `No space left on device`. The real database/Redis integration checks were run using a local, ignored `.local/compose.testing.yaml` override that placed their data under `/tmp`. Temporary dependency storage was also used. Those paths are disposable and do not establish durable storage. Free host disk space before using the standard persistent-volume Compose deployment; no unrelated project data was removed to address this blocker.
