# iPhone Ding implementation plan

Goal: shared Hono application with Hong Kong pickup monitoring, Bark and honest time-of-day analysis.
Architecture: runtime-neutral domain functions and SQL repository; atomic batches through SQLite and D1 adapters; Node timer / Durable Object Alarm adapters.
Stack: TypeScript, Hono, React/Vite, Drizzle, SQLite/D1.
Spec: user-approved plan in this chat.

- [x] Verify live Apple catalog and fulfillment response; retain sanitized fixtures and provenance.
- [x] Test state transitions and HK interval aggregation before implementation (first/recovery observations are not restocks).
- [x] Implement typed SQL schema, transactional repository, persisted round leases, observations and outbox.
- [x] Test and implement provider parsing, timeout/backoff, monitor orchestration and bounded Bark retries.
- [x] Test and implement authenticated Hono API, watch CRUD, historical filtering/stats/CSV and settings.
- [x] Implement Node and Workers adapters; exercise Wrangler local D1/DO and bundle checks.
- [x] Build phone-first four-tab UI; test real flows at mobile width with no invented stock data.
- [x] Deliver migrations, Docker/Caddy, Workers config, data transfer tools and deployment/runbooks.
- [x] Run full tests, typecheck, build and deployment dry run; record external credential limitations.

Constraints: HK time, target 30s polling, max 2 requests, 10s timeout, max 5m backoff, 365d analytics / 7d diagnostics. No orders or delivery monitoring. Execute inline; user already authorized implementation.

External validation limits: real Cloudflare deployment and Bark device delivery require user credentials; local workerd pickup returns HTTP403; Docker image pull is blocked by the configured local proxy. See docs/verification.md.
