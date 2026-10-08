# Distributed Job Queue Platform

[Canlı demo / Live demo](https://distributed-job-queue-alpha.vercel.app) · [Hosting details](docs/deployment.md)

Demo için **Try live demo** düğmesini kullanın. Ortak bir portföy demosudur; kişisel veri göndermeyin. Ücretsiz backend boşta kalınca uyur, ilk açılış yaklaşık bir dakika sürebilir.

Use **Try live demo** to enter the shared portfolio dashboard. Do not submit personal data. The free backend sleeps when idle; the first visit can take about a minute.

[🇹🇷 Türkçe](#türkçe) · [🇬🇧 English](#english)

---

## Türkçe

[Başa dön](#distributed-job-queue-platform) · [English bölümüne geç](#english)

PostgreSQL, Redis, Node.js ve Next.js kullanılarak geliştirilmiş dağıtık iş kuyruğu platformu.

Bu proje; arka plan işlerinin kuyruğa alınmasını, worker'lar tarafından işlenmesini, başarısız işlerin tekrar denenmesini ve tüm sürecin takip edilmesini sağlar. Arayüz bilinçli olarak sade tutulmuştur; odak backend güvenilirliği ve dağıtık sistem davranışıdır.

### Özellikler

- İş kuyruğuna yeni görev ekleme
- `queued`, `running`, `succeeded`, `failed` ve `cancelled` durumları
- Ayrı worker işlemleri
- Retry ve exponential backoff
- Dead-letter queue
- Idempotency key desteği
- Zamanlanmış görevler
- Görev iptali
- Worker lease recovery
- Görev geçmişi
- Durum ve tür bazlı filtreleme
- Sayfalama
- Temel metrikler
- Health ve readiness endpoint'leri
- Redis rate limiting
- Yapılandırılmış ve redakte edilmiş loglar
- Graceful shutdown
- Docker Compose ile lokal çalışma

### Örnek iş türleri

- `echo`: Bir mesajı geri döndürür.
- `sum`: Sayı listesinin toplamını hesaplar.
- `flaky`: Belirli sayıda başarısız olduktan sonra başarılı olur.
- `sleep`: İptal edilebilir bekleme görevi çalıştırır.

### Mimari

```text
Next.js Dashboard
        |
        v
Node.js API  <---->  Redis / BullMQ
        |                    |
        v                    v
PostgreSQL             Worker Processes
```

PostgreSQL görevlerin ve geçmişin kalıcı kaynağıdır. Redis; iş dağıtımı, worker lease'leri, retry zamanlaması ve rate limiting için kullanılır. Worker'lar görevleri Redis üzerinden alır ve durum güncellemelerini PostgreSQL'e yazar.

### Teknolojiler

- Next.js
- TypeScript
- Node.js
- Express
- PostgreSQL
- Prisma
- Redis
- BullMQ
- Docker Compose
- Vitest
- Playwright

### Lokal kurulum

Gereksinimler:

- Node.js 22.12+
- npm
- Docker ve Docker Compose

```bash
cp .env.example .env
npm ci
docker compose up --build -d
```

Dashboard: `http://localhost:3000`  
API: `http://localhost:4000`

Demo token, `.env` içindeki `DEMO_API_TOKEN` değeridir.

### Geliştirme komutları

```bash
npm run dev:api
npm run dev:worker
npm run dispatcher -w @queue/api
npm run dev:web
```

Migration ve seed:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

### API

```http
POST /api/jobs
GET /api/jobs
GET /api/jobs/:id
POST /api/jobs/:id/cancel
GET /api/metrics
GET /health
GET /ready
```

Yeni görev örneği:

```json
{
  "type": "echo",
  "payload": { "message": "hello" },
  "maxAttempts": 3,
  "backoffMs": 1000
}
```

Tekrar gönderimleri önlemek için `Idempotency-Key` header'ı kullanılabilir. Aynı anahtarla aynı istek tekrar gönderilirse mevcut görev döndürülür; farklı içerik gönderilirse istek reddedilir.

### Güvenlik

- API erişimi demo bearer token ile korunur.
- Rate limiting Redis üzerinden uygulanır.
- Görev payload'ları loglara yazılmaz.
- Token'lar ve ham hata içerikleri redakte edilir.
- Job işlemleri PostgreSQL transaction'larıyla güvence altına alınır.
- Worker claim token'ları eski worker'ların durum değiştirmesini engeller.
- Gerçek e-posta veya bildirim servisine bağlantı yoktur.
- Production credential'ları repoda bulunmaz.

### Testler

```bash
npm run typecheck
npm test
npm run test:integration
npm run test:smoke
npm audit
```

Test kapsamı: queue davranışı, retry/backoff, idempotency, concurrency, cancellation, worker recovery, pagination/filtering, API authorization, rate limiting, health/readiness ve browser dashboard akışı.

### Bilinen sınırlamalar

- Proje demo ve portföy amaçlıdır.
- Demo authentication production identity management değildir.
- Delivery modeli at-least-once'tur.
- Exactly-once external side effect garantisi yoktur.
- Dead-letter retention şu anda süresizdir.
- Dead-letter redrive arayüzü henüz yoktur.
- Global rate limiting için güvenilir proxy yapılandırması gerekir.
- Gerçek e-posta, push notification veya dış servis entegrasyonu yoktur.
- Canlı kurulum bir portföy demosudur; üretim SLA'sı ve yüksek hacimli load testleri bu sürümün kapsamı dışındadır.

[English bölümüne geç](#english) · [Başa dön](#distributed-job-queue-platform)

---

## English

[Back to top](#distributed-job-queue-platform) · [Türkçe bölümüne dön](#türkçe)

A distributed job queue platform built with PostgreSQL, Redis, Node.js, and Next.js.

The project accepts background jobs, processes them with workers, retries failed jobs, and exposes the complete execution history. The dashboard is intentionally simple; the main focus is backend reliability and distributed-system behavior.

### Features

- Enqueue new jobs
- `queued`, `running`, `succeeded`, `failed`, and `cancelled` states
- Separate worker processes
- Retry with exponential backoff
- Dead-letter queue
- Idempotency keys
- Scheduled jobs
- Job cancellation
- Worker lease recovery
- Job history
- Filtering by status and type
- Pagination
- Basic metrics
- Health and readiness endpoints
- Redis rate limiting
- Structured redacted logs
- Graceful shutdown
- Local Docker Compose environment

### Example job types

- `echo`: Returns a message.
- `sum`: Calculates the sum of a number list.
- `flaky`: Fails a configured number of times before succeeding.
- `sleep`: Runs a cancellable delay job.

### Architecture

```text
Next.js Dashboard
        |
        v
Node.js API  <---->  Redis / BullMQ
        |                    |
        v                    v
PostgreSQL             Worker Processes
```

PostgreSQL is the durable source of truth for jobs and history. Redis handles dispatching, worker leases, retry scheduling, and rate limiting. Workers claim jobs from Redis and persist state transitions to PostgreSQL.

### Technology

- Next.js
- TypeScript
- Node.js
- Express
- PostgreSQL
- Prisma
- Redis
- BullMQ
- Docker Compose
- Vitest
- Playwright

### Local setup

Requirements:

- Node.js 22.12+
- npm
- Docker and Docker Compose

```bash
cp .env.example .env
npm ci
docker compose up --build -d
```

Dashboard: `http://localhost:3000`  
API: `http://localhost:4000`

Use the `DEMO_API_TOKEN` value from `.env` to authenticate.

### Development commands

```bash
npm run dev:api
npm run dev:worker
npm run dispatcher -w @queue/api
npm run dev:web
```

Migrations and seed:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

### API

```http
POST /api/jobs
GET /api/jobs
GET /api/jobs/:id
POST /api/jobs/:id/cancel
GET /api/metrics
GET /health
GET /ready
```

Example job:

```json
{
  "type": "echo",
  "payload": { "message": "hello" },
  "maxAttempts": 3,
  "backoffMs": 1000
}
```

Use the `Idempotency-Key` header to prevent duplicate submissions. Repeating the same request with the same key returns the existing job; reusing the key with different content is rejected.

### Security

- API access is protected by a demo bearer token.
- Rate limiting is enforced through Redis.
- Job payloads are never written to logs.
- Tokens and raw error contents are redacted.
- Job operations use PostgreSQL transactions.
- Worker claim tokens prevent replaced workers from changing state.
- No real email or notification provider is contacted.
- Production credentials are not included in the repository.

### Testing

```bash
npm run typecheck
npm test
npm run test:integration
npm run test:smoke
npm audit
```

Coverage includes queue semantics, retry/backoff, idempotency, concurrency, cancellation, worker recovery, pagination/filtering, API authorization, rate limiting, health/readiness, and the browser dashboard flow.

### Known limitations

- This project is for demo and portfolio purposes.
- The demo authentication system is not production identity management.
- Delivery is at-least-once.
- Exactly-once external side effects are not guaranteed.
- Dead-letter retention is currently unbounded.
- A dead-letter redrive interface is not included yet.
- Global rate limiting requires a trusted proxy configuration.
- No real email, push notification, or external provider integration is included.
- The hosted deployment is a portfolio demo; production SLAs and high-volume load testing are outside the current scope.

[Back to top](#distributed-job-queue-platform) · [Türkçe bölümüne dön](#türkçe)
